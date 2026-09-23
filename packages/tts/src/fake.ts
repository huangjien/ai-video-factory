import type {
  TTSProvider,
  TTSRequest,
  TTSResult,
  TTSWord,
} from "./provider.js";

/**
 * Deterministic synthetic TTS for tests — no network. Returns a tiny valid
 * WAV file (44-byte RIFF header + a few samples of silence) so downstream
 * pipelines (ffmpeg conversion) can decode it without errors. Use only for
 * shape tests and pipeline wiring — the audio is silent, not real speech.
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
      sampleBytes: 4096,
      defaultCharsPerSecond: 5,
      ...opts,
    };
  }

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const chars = [...req.text].length;
    const cps = this.opts.defaultCharsPerSecond ?? 5;
    const durationMs = Math.max(500, Math.round((chars / cps) * 1000));
    const audio = makeSilentWav(this.opts.sampleBytes ?? 4096);
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

/**
 * Build a minimal valid WAV file: RIFF header + fmt chunk (PCM, 1ch, 8kHz,
 * 8-bit) + data chunk of `dataSize` bytes (silence). ~80 bytes total overhead
 * + dataSize.
 */
function makeSilentWav(dataSize: number): Uint8Array {
  const sampleRate = 8000;
  const bitsPerSample = 8;
  const numChannels = 1;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const fmtChunkSize = 16;
  const riffChunkSize = 4 + (8 + fmtChunkSize) + (8 + dataSize);

  const buf = new Uint8Array(8 + riffChunkSize);
  const view = new DataView(buf.buffer);
  // RIFF header
  buf.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, riffChunkSize, true);
  buf.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
  // fmt chunk
  buf.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, fmtChunkSize, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // data chunk
  buf.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, dataSize, true);
  // 8-bit PCM silence = 0x80 (centered); already zero-filled by Uint8Array
  return buf;
}
