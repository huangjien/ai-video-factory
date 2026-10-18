import type { TTSProvider, TTSRequest, TTSResult } from "./provider.js";
import { TTSError } from "./provider.js";

export interface VoiceboxTTSProviderOptions {
  /** Voicebox backend base URL. Default: $VOICEBOX_URL or http://127.0.0.1:17493
   * (the local voicebox-server LaunchAgent ships with the desktop app). */
  baseUrl?: string;
  /** Model size for engines that have variants (qwen: "1.7B" | "0.6B").
   * Default "1.7B" — the server default. */
  modelSize?: string;
  /** TTS engine override. Default: omit → the profile's default_engine. */
  engine?: string;
  /** Poll interval for the async generation job. Default 2000 ms. */
  pollIntervalMs?: number;
  /** Overall budget for one synthesize() call (submit + poll + download).
   * Default 600 s — cloned-voice synthesis runs ~7x slower than realtime
   * on MLX, so a 60 s narration legitimately takes minutes. */
  timeoutMs?: number;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Playback rate passed to voice_setting.speed. Default 1.
   *  0.9 = slightly slower (more intelligible narration); Qwen3-TTS honors it. */
  speed?: number;
  /** When > 0, the narration is split on sentence-ending punctuation
   *  (keeping the punctuation on each sentence) and each sentence is
   *  synthesized as a separate backend call. The pieces are ffmpeg-concat'd
   *  with `apad` inserting this many seconds of silence between sentences.
   *  Qwen3-TTS has no native pause marker, so this is the only way to get
   *  inter-sentence breathing room while keeping the cloned voice. Cost:
   *  one backend round-trip per sentence (each ~7x realtime on MLX). */
  sentencePauseSec?: number;
}

interface VoiceboxProfile {
  id: string;
  name: string;
}

interface VoiceboxHistoryEntry {
  id: string;
  status?: string | null;
  duration?: number | null;
  error?: string | null;
}

/** A GET /profiles doubles as the health probe: 2xx means the local
 * voicebox-server is up, and the listing carries the cloned-profile names
 * the draft question offers. Never throws — an unreachable server is
 * healthy: false, not an error. */
export async function voiceboxStatus(opts?: {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ healthy: boolean; profiles: string[] }> {
  const baseUrl = (
    opts?.baseUrl ?? process.env.VOICEBOX_URL ?? "http://127.0.0.1:17493"
  ).replace(/\/+$/, "");
  const fetchImpl = opts?.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${baseUrl}/profiles`, {
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 2000),
    });
    if (!res.ok) return { healthy: false, profiles: [] };
    const profiles = (await res.json()) as Array<{ name?: string }>;
    return {
      healthy: true,
      profiles: profiles
        .map((p) => p.name ?? "")
        .filter((name) => name.length > 0),
    };
  } catch {
    return { healthy: false, profiles: [] };
  }
}

/** MiniMax system narration voices (platform.minimax.io/docs/faq/system-voice-id,
 * probed 2026-10-18) used when the local clone is unavailable. */
export const MINIMAX_SYSTEM_VOICE: Record<string, string> = {
  "zh-CN": "Chinese (Mandarin)_Male_Announcer",
  "en-US": "English_expressive_narrator",
};

export function minimaxSystemVoice(language: string): string {
  return MINIMAX_SYSTEM_VOICE[language] ?? MINIMAX_SYSTEM_VOICE["en-US"]!;
}

/** Parse a `--tts` / video-ask `tts` answer into frontmatter values.
 * Shapes: "voicebox:<profile>", "minimax-system", "edge". */
export function parseTtsChoice(
  choice: string,
  language: string,
): { ttsProvider: string; voice?: string } {
  if (choice.startsWith("voicebox:")) {
    const profile = choice.slice("voicebox:".length).trim();
    return { ttsProvider: "voicebox", ...(profile ? { voice: profile } : {}) };
  }
  if (choice === "minimax-system") {
    return { ttsProvider: "minimax", voice: minimaxSystemVoice(language) };
  }
  return { ttsProvider: "edge" };
}

/**
 * Local Voicebox (voicebox.sh) TTS adapter over its REST API.
 *
 * Voicebox v0.5.0 generates asynchronously: POST /generate returns immediately
 * with status "generating", the row flips to completed/failed in the history
 * table, and the audio is served from GET /audio/{id}. There is no
 * OpenAI-compatible /v1/audio/speech on v0.5.0 (404 — added later upstream),
 * so this provider drives the three-step flow directly.
 *
 * `req.voice` is the Voicebox voice profile, by id or by name
 * (case-insensitive; names are what a human types into article.md).
 *
 * Output is WAV (24 kHz from the qwen engine). Callers that detect RIFF
 * headers write it as-is; @video/make's syncSceneDurations then rewrites the
 * storyboard to the measured length, so no padding is needed here.
 *
 * Not supported (ignored): `pauseBetweenSentencesSec` — Voicebox has no
 * SSML break insertion; the engine's own prosody stands. `words` is always
 * empty: the API exposes no word-level timings, and no make-path consumer
 * reads them.
 */
export class VoiceboxTTSProvider implements TTSProvider {
  private readonly speed: number | undefined;
  private readonly sentencePauseSec: number;
  readonly name = "voicebox";
  private readonly baseUrl: string;
  private readonly modelSize: string | undefined;
  private readonly engine: string | undefined;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  /** Profile listing, fetched on first use and refreshed once per miss —
   * a profile created after this provider was constructed still resolves. */
  private profiles: VoiceboxProfile[] | undefined;

  constructor(opts: VoiceboxTTSProviderOptions = {}) {
    this.baseUrl = (
      opts.baseUrl ?? process.env.VOICEBOX_URL ?? "http://127.0.0.1:17493"
    ).replace(/\/+$/, "");
    this.modelSize = opts.modelSize;
    this.engine = opts.engine;
    this.pollIntervalMs = opts.pollIntervalMs ?? 2000;
    this.timeoutMs = opts.timeoutMs ?? 600_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
      this.speed = opts.speed;
    this.sentencePauseSec = opts.sentencePauseSec ?? 0;
}

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const profileId = await this.resolveProfileId(req.voice);

    // When sentencePauseSec is set, split on sentence-ending punctuation
    // (keeping the punctuation on each sentence) and stitch the per-sentence
    // audio with this many seconds of silence between. Qwen3-TTS has no
    // native pause marker — this is the only way to get inter-sentence
    // breathing room while keeping the cloned voice.
    const sentences = this.sentencePauseSec > 0 ? splitSentences(req.text) : null;

    if (sentences !== null) {
      const pieces: Array<{ audio: Uint8Array; durationMs: number }> = [];
      for (const s of sentences) {
        pieces.push(await this.generateOne(s, profileId, req.language));
      }
      return stitchWithPauses(pieces, this.sentencePauseSec, this.timeoutMs);
    }

    const one = await this.generateOne(req.text, profileId, req.language);
    return { audio: one.audio, durationMs: one.durationMs, words: [] };
  }

  /** One full round-trip: POST /generate, poll /history, GET /audio. */
  private async generateOne(
    text: string,
    profileId: string,
    language: string,
  ): Promise<{ audio: Uint8Array; durationMs: number }> {
    const body: Record<string, unknown> = {
      profile_id: profileId,
      text,
      language: language.split("-")[0]!.toLowerCase(),
    };
    if (this.modelSize !== undefined) body.model_size = this.modelSize;
    if (this.engine !== undefined) body.engine = this.engine;
    if (this.speed !== undefined) body.speed = this.speed;

    const deadline = Date.now() + this.timeoutMs;
    const gen = await this.requestJson<{ id: string }>(
      "POST",
      "/generate",
      body,
      deadline,
    );

    let entry: VoiceboxHistoryEntry;
    for (;;) {
      entry = await this.requestJson<VoiceboxHistoryEntry>(
        "GET",
        `/history/${gen.id}`,
        undefined,
        deadline,
      );
      const status = entry.status ?? "completed";
      if (status === "completed" || status === "failed") break;
      if (Date.now() >= deadline) {
        throw new TTSError(
          `Voicebox generation ${gen.id} did not finish within ${this.timeoutMs} ms (status: ${status})`,
          this.name,
        );
      }
      // Same executor-form sleep as llm/retry.ts + minimax-video.ts — the
      // base tsconfig lib is ES2022, so Promise.withResolvers is unavailable.
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
    if (entry.status === "failed") {
      throw new TTSError(
        `Voicebox generation failed: ${entry.error ?? "unknown error"}`,
        this.name,
      );
    }

    const audio = await this.requestBytes(`/audio/${gen.id}`, deadline);
    return {
      audio,
      durationMs: Math.round((entry.duration ?? 0) * 1000),
    };
  }

  /** Map a profile name or id to the id /generate requires. */
  private async resolveProfileId(voice: string): Promise<string> {
    const wanted = voice.toLowerCase();
    const fromCache = this.profiles?.find(
      (p) => p.id.toLowerCase() === wanted || p.name.toLowerCase() === wanted,
    );
    const profile = fromCache ?? (await this.fetchProfiles()).find(
      (p) => p.id.toLowerCase() === wanted || p.name.toLowerCase() === wanted,
    );
    if (profile === undefined) {
      throw new TTSError(
        `Voicebox profile not found: ${JSON.stringify(voice)} (known: ${
          (this.profiles ?? []).map((p) => p.name).join(", ") || "none"
        })`,
        this.name,
        404,
      );
    }
    return profile.id;
  }

  private async fetchProfiles(): Promise<VoiceboxProfile[]> {
    this.profiles = await this.requestJson<VoiceboxProfile[]>(
      "GET",
      "/profiles",
      undefined,
      Date.now() + this.timeoutMs,
    );
    return this.profiles;
  }

  private async requestJson<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    deadline: number,
  ): Promise<T> {
    const res = await this.doFetch(method, path, body, deadline);
    const text = await res.text();
    if (!res.ok) {
      throw new TTSError(
        `Voicebox ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`,
        this.name,
        res.status,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new TTSError(
        `Voicebox ${method} ${path} returned non-JSON: ${text.slice(0, 120)}`,
        this.name,
      );
    }
  }

  private async requestBytes(
    path: string,
    deadline: number,
  ): Promise<Uint8Array> {
    const res = await this.doFetch("GET", path, undefined, deadline);
    if (!res.ok) {
      const text = await res.text();
      throw new TTSError(
        `Voicebox GET ${path} failed (${res.status}): ${text.slice(0, 300)}`,
        this.name,
        res.status,
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  private async doFetch(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    deadline: number,
  ): Promise<Response> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new TTSError(
        `Voicebox ${method} ${path}: timed out before request`,
        this.name,
      );
    }
    try {
      const init: RequestInit = {
        method,
        signal: AbortSignal.timeout(remaining),
        // Conditional spread keeps `body`/`headers` absent (not `undefined`)
        // under exactOptionalPropertyTypes.
        ...(body !== undefined && {
          headers: { "Content-Type": "application/json" } as Record<string, string>,
          body: JSON.stringify(body),
        }),
      };
      return await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new TTSError(
        `Voicebox ${method} ${path}: ${(err as Error).message}`,
        this.name,
      );
    }
  }
}


/** Split narration on sentence-ending punctuation (keeping the punctuation
 *  on each sentence). Returns a non-empty array of trimmed sentence strings
 *  in source order. */
export function splitSentences(text: string): string[] {
  const parts = text.split(/([\u3002\uff01\uff1f.!?]+\s*)/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = (parts[i] ?? "").trim();
    const sep = parts[i + 1] ?? "";
    if (body.length === 0 && sep.length === 0) continue;
    out.push((body + sep).trim());
  }
  return out.filter((s) => s.length > 0);
}

/** Concat pre-synthesized sentence WAVs into one stream, padding each with
 *  `pauseSec` of silence (the last segment is NOT padded). All pieces come
 *  from the same voicebox backend so they share format/encoding. */
async function stitchWithPauses(
  pieces: Array<{ audio: Uint8Array; durationMs: number }>,
  pauseSec: number,
  timeoutMs: number,
): Promise<TTSResult> {
  if (pieces.length === 0) {
    throw new TTSError("stitchWithPauses: no pieces", "voicebox");
  }
  if (pieces.length === 1) {
    return {
      audio: pieces[0]!.audio,
      durationMs: pieces[0]!.durationMs,
      words: [],
    };
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const execFileAsync = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), "voicebox-tts-"));
  try {
    const inputs: string[] = [];
    const filterParts: string[] = [];
    const labels: string[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const p = join(dir, `s${i}.wav`);
      await writeFile(p, pieces[i]!.audio);
      inputs.push("-i", p);
      const dur =
        pieces[i]!.durationMs / 1000 + (i < pieces.length - 1 ? pauseSec : 0);
      filterParts.push(`[${i}:a]apad=pad_dur=${dur.toFixed(3)}[s${i}]`);
      labels.push(`[s${i}]`);
    }
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        ...inputs,
        "-filter_complex",
        `${filterParts.join(";")};${labels.join("")}concat=n=${pieces.length}:v=0:a=1[out]`,
        "-map", "[out]",
        join(dir, "out.wav"),
      ],
      { timeout: timeoutMs },
    );
    const audio = await readFile(join(dir, "out.wav"));
    const totalMs = pieces.reduce(
      (acc, p, i) =>
        acc + p.durationMs + (i < pieces.length - 1 ? pauseSec * 1000 : 0),
      0,
    );
    return { audio, durationMs: Math.round(totalMs), words: [] };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
