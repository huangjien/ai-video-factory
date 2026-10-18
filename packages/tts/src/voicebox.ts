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
  }

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const profileId = await this.resolveProfileId(req.voice);

    const body: Record<string, unknown> = {
      profile_id: profileId,
      text: req.text,
      // GenerationRequest.language accepts region-less codes ("zh", "en", …);
      // the article schema's "zh-CN"/"en-US" would 422.
      language: req.language.split("-")[0]!.toLowerCase(),
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

    // Poll the history row — NOT GET /generate/{id}/status, which is an SSE
    // stream that never yields a plain JSON body (verified on v0.5.0: a naive
    // curl poll reads nothing and spins forever).
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
      words: [],
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
