import { EdgeTTS } from "edge-tts-universal";
import type {
  TTSProvider,
  TTSRequest,
  TTSResult,
  TTSWord,
} from "./provider.js";

export interface EdgeTTSProviderOptions {
  /** Override the default Edge TTS endpoint (rare; default is Microsoft's public endpoint). */
  endpoint?: string | undefined;
  /** Prosody: rate, volume, pitch. */
  rate?: string;
  volume?: string;
  pitch?: string;
  /** When WordBoundary events are unavailable (rare), estimate duration from this char rate. */
  charsPerSecond?: number;
}

/**
 * Microsoft Edge online TTS adapter (edge-tts-universal package).
 * No API key — uses Edge's free online endpoint. May rate-limit or fail
 * without network — callers must handle TTSError gracefully.
 */
export class EdgeTTSProvider implements TTSProvider {
  readonly name = "edge";
  private readonly opts: EdgeTTSProviderOptions;

  constructor(opts: EdgeTTSProviderOptions = {}) {
    this.opts = opts;
  }

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const tts = new EdgeTTS(req.text, req.voice, {
      ...(this.opts.rate !== undefined ? { rate: this.opts.rate } : {}),
      ...(this.opts.volume !== undefined ? { volume: this.opts.volume } : {}),
      ...(this.opts.pitch !== undefined ? { pitch: this.opts.pitch } : {}),
    });
    const result = await tts.synthesize();
    const audio = new Uint8Array(await result.audio.arrayBuffer());
    const words = parseSubtitleToWords(result.subtitle);
    const durationMs =
      words.length > 0
        ? (words[words.length - 1]?.endMs ?? 0)
        : estimateDurationMs(req.text, this.opts.charsPerSecond);
    return { audio, durationMs, words };
  }
}

function parseSubtitleToWords(subtitle: unknown): TTSWord[] {
  if (!Array.isArray(subtitle)) return [];
  return subtitle
    .filter(
      (e): e is { text?: unknown; startMs?: unknown; endMs?: unknown } =>
        typeof e === "object" && e !== null,
    )
    .map((e) => ({
      text: String(e.text ?? ""),
      startMs: Number(e.startMs ?? 0),
      endMs: Number(e.endMs ?? 0),
    }))
    .filter((w) => w.text.length > 0);
}

function estimateDurationMs(text: string, cps = 5): number {
  const chars = [...text].length;
  return Math.max(500, Math.round((chars / cps) * 1000));
}

/** Test-only factory — the real EdgeTTSProvider talks to Microsoft; we expose
 * a mock for vitest that returns canned bytes without network. */
export interface MockEdgeTTSOptions extends EdgeTTSProviderOptions {
  sampleBytes?: number;
}

export function mockEdgeTTSProvider(
  opts: MockEdgeTTSOptions = {},
): TTSProvider {
  return {
    name: "edge-mock",
    async synthesize(req: TTSRequest): Promise<TTSResult> {
      const chars = [...req.text].length;
      const cps = opts.charsPerSecond ?? 5;
      const durationMs = Math.max(500, Math.round((chars / cps) * 1000));
      return {
        audio: new Uint8Array(opts.sampleBytes ?? 1024),
        durationMs,
        words: [],
      };
    },
  };
}
