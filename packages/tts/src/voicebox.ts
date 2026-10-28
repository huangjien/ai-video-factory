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
  /** Playback rate applied to the SYNTHESIZED audio. Default 1.
   *  0.9 = slightly slower (more intelligible narration).
   *
   *  The voicebox server's GenerationRequest has no speed/tempo field —
   *  sending one was silently ignored, so the narrator always came out
   *  at its natural pace. The rate is therefore applied locally with
   *  ffmpeg's `atempo`, which stretches time while holding the pitch.
   *  0.84 → the audio is 1/0.84 ≈ 1.19× longer. */
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
    opts?.baseUrl ??
    process.env.VOICEBOX_URL ??
    "http://127.0.0.1:17493"
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

/** Edge TTS system voices — the fallback backend and the only backend
 * whose voice ids encode their own locale. Male narration by default;
 * the female alternatives live in the audio-plan prompt. */
export const EDGE_SYSTEM_VOICE: Record<string, string> = {
  "zh-CN": "zh-CN-YunjianNeural",
  "en-US": "en-US-ChristopherNeural",
};

export function edgeSystemVoice(language: string): string {
  return EDGE_SYSTEM_VOICE[language] ?? EDGE_SYSTEM_VOICE["en-US"]!;
}

/** True when a voice id belongs to Edge TTS. Edge ids are the only ones
 * that encode their locale, so they are also the only ones a reader can
 * check by eye — and the one way to tell "a human pinned the Edge
 * backend" from "the default voice happened to be written down". */
export function isEdgeVoiceId(voice: string): boolean {
  return /^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9]+Neural$/.test(voice.trim());
}

/** The default voice id for a narration backend.
 *
 * The provider and the voice id must agree: an Edge id handed to MiniMax
 * (or a MiniMax id handed to Edge) fails at synthesis, not at config
 * time — so the two are always resolved together, never independently.
 */
export function defaultVoiceForProvider(
  provider: string,
  language: string,
): string {
  if (provider === "edge") return edgeSystemVoice(language);
  // voicebox takes a PROFILE NAME, not a voice id; there is no sensible
  // default, so the caller must supply one.
  if (provider === "voicebox") return "";
  return minimaxSystemVoice(language);
}

/** Parse a `--tts` / video-ask `tts` answer into frontmatter values.
 * Shapes: "voicebox:<profile>", "minimax-system", "minimax-hd", "f5tts",
 * "edge". */
export function parseTtsChoice(
  choice: string,
  language: string,
): { ttsProvider: string; voice?: string } {
  if (choice.startsWith("voicebox:")) {
    const profile = choice.slice("voicebox:".length).trim();
    return { ttsProvider: "voicebox", ...(profile ? { voice: profile } : {}) };
  }
  if (choice === "f5tts") {
    // No voice stamp: F5TTSProvider defaults to the narrator-zh
    // reference clip; a frontmatter `voice:` pointing at another wav
    // (with its .txt transcript) overrides it at make time.
    return { ttsProvider: "f5tts" };
  }
  if (choice === "minimax-system" || choice === "minimax-hd") {
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
      opts.baseUrl ??
      process.env.VOICEBOX_URL ??
      "http://127.0.0.1:17493"
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
    const sentences =
      this.sentencePauseSec > 0 ? splitSentences(req.text) : null;

    if (sentences !== null) {
      const pieces: Array<{ audio: Uint8Array; durationMs: number }> = [];
      for (const s of sentences) {
        pieces.push(await this.generateOne(s, profileId, req.language));
      }
      const stitched = await stitchWithPauses(
        pieces,
        this.sentencePauseSec,
        this.timeoutMs,
      );
      return this.applyTempo(stitched);
    }

    const one = await this.generateOne(req.text, profileId, req.language);
    return this.applyTempo({
      audio: one.audio,
      durationMs: one.durationMs,
      words: [],
    });
  }

  /**
   * Apply the requested playback rate to the finished audio.
   *
   * The rate is a STRETCH factor applied with ffmpeg's `atempo`: 0.84
   * makes the narration 1/0.84 ≈ 1.19× longer, holding the pitch. It is
   * applied AFTER the sentence stitch, so the pauses stretch with the
   * speech and the breathing room scales too.
   */
  private async applyTempo(result: TTSResult): Promise<TTSResult> {
    const tempo = this.speed;
    if (tempo === undefined || tempo === 1 || result.audio.length === 0) {
      return result;
    }
    if (tempo <= 0) {
      throw new TTSError("voicebox speed must be > 0", this.name);
    }
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { mkdtemp, writeFile, readFile, rm } =
      await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const execFileAsync = promisify(execFile);
    const dir = await mkdtemp(join(tmpdir(), "voicebox-tempo-"));
    const src = join(dir, "in.wav");
    const out = join(dir, "out.wav");
    try {
      await writeFile(src, result.audio);
      // atempo accepts 0.5–2.0 in one pass; chain for anything wider.
      const factor = Math.min(2, Math.max(0.5, tempo));
      await execFileAsync(
        "ffmpeg",
        ["-y", "-i", src, "-af", `atempo=${factor}`, "-c:a", "pcm_s16le", out],
        { timeout: this.timeoutMs },
      );
      const audio = new Uint8Array(await readFile(out));
      // Measure the result rather than dividing by the tempo: atempo's
      // effective factor on a short clip is not exactly 1/tempo (silence
      // and the clip's own shape shift it), and a reported duration that
      // disagrees with the bytes is worse than no number.
      const probed = await probeWavDuration(out);
      return {
        ...result,
        audio,
        durationMs: probed ?? Math.round(result.durationMs / tempo),
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
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
    // Defensive duration: voicebox's `entry.duration` is a backend-reported
    // estimate that sometimes overshoots the actual wav length (model may
    // truncate mid-sentence). Probe the bytes via ffprobe and use the
    // smaller of the two so the caller gets a real upper bound. Warn on
    // >5% mismatch so we notice if the backend starts lying more often.
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, writeFileSync, readFileSync, rmSync } =
      await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    let actualSec = 0;
    const probeDir = mkdtempSync(join(tmpdir(), "voicebox-dur-"));
    try {
      writeFileSync(join(probeDir, "x.wav"), audio);
      const stdout = execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          join(probeDir, "x.wav"),
        ],
        { encoding: "utf8" as const, timeout: 5000 },
      );
      actualSec = Number.parseFloat(String(stdout).trim());
      if (!Number.isFinite(actualSec)) actualSec = 0;
    } catch {
      // ffprobe missing or failed — keep the backend's duration.
    } finally {
      try {
        rmSync(probeDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    const reportedSec = entry.duration ?? 0;
    const useSec =
      actualSec > 0 ? Math.min(reportedSec, actualSec) : reportedSec;
    if (reportedSec > 0 && actualSec > 0) {
      const diff = Math.abs(reportedSec - actualSec) / reportedSec;
      if (diff > 0.05) {
        console.warn(
          `voicebox: backend reported ${reportedSec.toFixed(2)}s but wav is ${actualSec.toFixed(2)}s for gen ${gen.id} (${(diff * 100).toFixed(1)}% off)`,
        );
      }
    }
    return {
      audio,
      durationMs: Math.round(useSec * 1000),
    };
  }

  /** Map a profile name or id to the id /generate requires. */
  private async resolveProfileId(voice: string): Promise<string> {
    const wanted = voice.toLowerCase();
    const fromCache = this.profiles?.find(
      (p) => p.id.toLowerCase() === wanted || p.name.toLowerCase() === wanted,
    );
    const profile =
      fromCache ??
      (await this.fetchProfiles()).find(
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
          headers: { "Content-Type": "application/json" } as Record<
            string,
            string
          >,
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
/** The duration of a WAV file in ms, measured with ffprobe. Returns null
 *  when ffprobe is unavailable or the file is unreadable. */
async function probeWavDuration(file: string): Promise<number | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const execFileAsync = promisify(execFile);
    const out = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    const sec = Number.parseFloat(out.stdout.trim());
    return Number.isFinite(sec) ? Math.round(sec * 1000) : null;
  } catch {
    return null;
  }
}

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
      // Pad each piece by the PAUSE ONLY. Padding by the piece's own
      // duration doubled every sentence's audio — a single-sentence scene
      // was right (it skips this path) while a two-sentence scene came out
      // roughly twice as long, which dragged the measured narration rate
      // down to a third of the intended pace.
      const pause = i < pieces.length - 1 ? pauseSec : 0;
      filterParts.push(`[${i}:a]apad=pad_dur=${pause.toFixed(3)}[s${i}]`);
      labels.push(`[s${i}]`);
    }
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        ...inputs,
        "-filter_complex",
        `${filterParts.join(";")};${labels.join("")}concat=n=${pieces.length}:v=0:a=1[out]`,
        "-map",
        "[out]",
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
