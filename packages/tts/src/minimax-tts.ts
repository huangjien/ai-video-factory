import type { TTSProvider, TTSRequest, TTSResult } from "./provider.js";
import { TTSError } from "./provider.js";

export interface MinimaxTTSProviderOptions {
  /** API host. Default: $MINIMAX_API_HOST or https://api.minimax.io — the
   * same env the image/video/music providers already honor. */
  apiHost?: string;
  /** T2A model. Default "speech-2.8-turbo" (fastest tier that still takes
   * interjection tags); use "speech-2.8-hd" for quality. */
  model?: string;
  /** voice_setting passthrough: speed 0.5–2, vol >0–10, pitch −12–12. */
  speed?: number;
  vol?: number;
  pitch?: number;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

interface T2aV2Response {
  data?: { audio?: string | null; status?: number } | null;
  extra_info?: { audio_length?: number | null } | null;
  base_resp?: { status_code?: number; status_msg?: string } | null;
  trace_id?: string;
}

/**
 * MiniMax T2A v2 adapter (platform.minimax.io/docs/api-reference/speech-t2a-http).
 *
 * One synchronous POST /v1/t2a_v2 per scene, non-streaming, audio returned
 * hex-encoded (output_format "hex"). Decoded bytes are MP3 — the make
 * pipeline's mp3ToWav then normalizes to 44.1 kHz mono and pads to the
 * scene duration, exactly as it does for Edge TTS.
 *
 * `req.voice` is the MiniMax `voice_setting.voice_id`: a system voice or,
 * for cloned narration, the voice_id created via the voice-clone flow
 * (/v1/files/upload purpose=voice_clone → /v1/voice_clone). Note MiniMax
 * deletes a cloned voice that goes unused for 7 days.
 *
 * `pauseBetweenSentencesSec` is honored with MiniMax's native pause markers
 * (`<#x#>` between sentences) rather than Edge's silence-concat trick.
 */
export class MinimaxTTSProvider implements TTSProvider {
  readonly name = "minimax-tts";
  private readonly apiHost: string;
  private readonly model: string;
  private readonly speed: number | undefined;
  private readonly vol: number | undefined;
  private readonly pitch: number | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: MinimaxTTSProviderOptions = {}) {
    this.apiHost = (
      opts.apiHost ??
      process.env["MINIMAX_API_HOST"] ??
      "https://api.minimax.io"
    ).replace(/\/+$/, "");
    this.model = opts.model ?? "speech-2.8-turbo";
    this.speed = opts.speed;
    this.vol = opts.vol;
    this.pitch = opts.pitch;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const key = process.env["MINIMAX_API_KEY"];
    if (!key) {
      throw new TTSError("MINIMAX_API_KEY not set in environment", this.name);
    }

    const pause = req.pauseBetweenSentencesSec ?? 0;
    // Insert a `<#x#>` pause marker after each sentence-ending punctuation
    // run that still has text after it (skip the final one). splitSentences
    // from edge-tts.ts DROPS the punctuation — unusable here, since the
    // markers must keep it for prosody. An ASCII "." between digits is left
    // alone so "3.5" survives.
    const text =
      pause > 0
        ? req.text.replace(
            /([。！？!?]+|\.(?!\d))(\s*)(?=\S)/g,
            `$1$2<#${pause.toFixed(2)}#>`,
          )
        : req.text;

    const voiceSetting: Record<string, number | string> = {
      voice_id: req.voice,
      speed: this.speed ?? 1,
      vol: this.vol ?? 1,
      pitch: this.pitch ?? 0,
    };
    // language_boost speeds up nothing but stabilizes code switching; the
    // article languages map 1:1, anything exotic goes to "auto".
    const languageBoost = req.language.startsWith("zh")
      ? "Chinese"
      : req.language.startsWith("en")
        ? "English"
        : "auto";

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiHost}/v1/t2a_v2`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: this.model,
          text,
          stream: false,
          output_format: "hex",
          language_boost: languageBoost,
          voice_setting: voiceSetting,
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: "mp3",
            channel: 1,
          },
        }),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (err) {
      throw new TTSError(
        `MiniMax T2A request failed: ${(err as Error).message}`,
        this.name,
      );
    }

    const raw = await res.text();
    if (!res.ok) {
      throw new TTSError(
        `MiniMax T2A HTTP ${res.status}: ${raw.slice(0, 300)}`,
        this.name,
        res.status,
      );
    }

    let body: T2aV2Response;
    try {
      body = JSON.parse(raw) as T2aV2Response;
    } catch {
      throw new TTSError(
        `MiniMax T2A returned non-JSON: ${raw.slice(0, 120)}`,
        this.name,
      );
    }
    // MiniMax reports failures inside HTTP 200 via base_resp.status_code
    // (1004/1008 auth/balance, 1002 rate limit, …) — check it explicitly.
    const statusCode = body.base_resp?.status_code ?? 0;
    if (statusCode !== 0) {
      throw new TTSError(
        `MiniMax T2A error ${statusCode}: ${body.base_resp?.status_msg ?? "unknown"}${
          body.trace_id ? ` (trace ${body.trace_id})` : ""
        }`,
        this.name,
        statusCode,
      );
    }
    const hex = body.data?.audio;
    if (typeof hex !== "string" || hex.length === 0) {
      throw new TTSError(
        `MiniMax T2A returned no audio (status ${body.data?.status ?? "?"})`,
        this.name,
      );
    }

    return {
      audio: new Uint8Array(Buffer.from(hex, "hex")),
      durationMs: body.extra_info?.audio_length ?? 0,
      words: [],
    };
  }
}
