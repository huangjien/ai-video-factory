import type { TTSProvider, TTSRequest, TTSResult, TTSWord } from "./provider.js";

/**
 * Deterministic synthetic TTS for tests — no network. Returns fake mp3 bytes
 * (just zero-filled buffer of `sampleBytes`) and word boundaries computed
 * from the input text. Audio is NOT playable — use only for shape tests
 * and pipeline wiring.
 */
export interface FakeTTSOptions {
  sampleBytes?: number;
  defaultCharsPerSecond?: number;
}

export class FakeTTSProvider implements TTSProvider {
  readonly name = "fake";
  private readonly opts: FakeTTSOptions;

  constructor(opts: FakeTTSOptions = {}) {
    this.opts = {
      sampleBytes: 1024,
      defaultCharsPerSecond: 5,
      ...opts,
    };
  }

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const chars = [...req.text].length;
    const cps = this.opts.defaultCharsPerSecond ?? 5;
    const durationMs = Math.max(500, Math.round((chars / cps) * 1000));
    const audio = new Uint8Array(this.opts.sampleBytes ?? 1024);
    const words = computeWords(req.text, durationMs);
    return { audio, durationMs, words };
  }
}

function computeWords(text: string, totalMs: number): TTSWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const each = totalMs / tokens.length;
  return tokens.map((t, i) => ({
    text: t,
    startMs: Math.round(i * each),
    endMs: Math.round((i + 1) * each),
  }));
}
