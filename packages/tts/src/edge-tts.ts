import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { EdgeTTS } from "edge-tts-universal";
import type {
  TTSProvider,
  TTSRequest,
  TTSResult,
  TTSWord,
} from "./provider.js";

const execFileAsync = promisify(execFile);

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
 *
 * NOTE: edge-tts-universal always wraps `text` in a `<speak><voice><prosody>`
 * SSML envelope and HTML-escapes the user's input. That means literal
 * `<break>` tags do NOT work — they get read aloud as "break time 1000ms".
 * So `pauseBetweenSentencesSec` is honored via post-processing:
 * split into sentences, synthesize each separately, ffmpeg-concat with
 * literal silence gaps. See `pauseBetweenSentencesSec` on `TTSRequest`.
 */
export class EdgeTTSProvider implements TTSProvider {
  readonly name = "edge";
  private readonly opts: EdgeTTSProviderOptions;

  constructor(opts: EdgeTTSProviderOptions = {}) {
    this.opts = opts;
  }

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const pauseSec = req.pauseBetweenSentencesSec ?? 0;
    // Fast path: no inter-sentence pause, or only one sentence.
    const sentences =
      pauseSec > 0 ? splitSentences(req.text) : [];
    if (pauseSec <= 0 || sentences.length <= 1) {
      return this.synthesizeOne(req.text, req.voice);
    }
    // Slow path: post-process — synthesize each sentence, concatenate with
    // literal silence gaps via ffmpeg.
    const parts = await Promise.all(
      sentences.map((s) => this.synthesizeOne(s, req.voice)),
    );
    return await concatenateWithSilence(parts, pauseSec);
  }

  private async synthesizeOne(
    text: string,
    voice: string,
  ): Promise<TTSResult> {
    const tts = new EdgeTTS(text, voice, {
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
        : estimateDurationMs(text, this.opts.charsPerSecond);
    return { audio, durationMs, words };
  }
}

/** Split text on sentence-ending punctuation. Captured separators
 * remain in the array at odd indices (so we can preserve whitespace
 * if needed). Caller trims each segment. Exported for tests + downstream
 * tooling that wants to know the sentence boundaries of a narration. */
export function splitSentences(text: string): string[] {
  const parts = text.split(/([。！？.!?]+\s*)/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const s = (parts[i] ?? "").trim();
    if (s.length > 0) out.push(s);
  }
  return out;
}

/** Concatenate `parts` with `pauseSec` seconds of silence between each
 * pair. Each input is a TTSResult whose `.audio` is MP3 (Edge default)
 * or WAV. Returns a single TTSResult with merged bytes + offset-reset
 * word timestamps. */
async function concatenateWithSilence(
  parts: TTSResult[],
  pauseSec: number,
): Promise<TTSResult> {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "vf-tts-pause-"));
  try {
    const wavPaths: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const mp3Path = path.join(tmpRoot, `p${i}.mp3`);
      const wavPath = path.join(tmpRoot, `p${i}.wav`);
      await writeFile(mp3Path, parts[i]!.audio);
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        mp3Path,
        "-ar",
        "44100",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        wavPath,
      ]);
      wavPaths.push(wavPath);
    }

    const silencePath = path.join(tmpRoot, "silence.wav");
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-t",
      String(pauseSec),
      silencePath,
    ]);

    const listLines = [""];
    for (let i = 0; i < wavPaths.length; i++) {
      listLines.push(`file '${path.basename(wavPaths[i]!)}'`);
      if (i < wavPaths.length - 1) {
        listLines.push(`file '${path.basename(silencePath)}'`);
      }
    }
    const listPath = path.join(tmpRoot, "list.txt");
    await writeFile(listPath, listLines.join("\n") + "\n");

    const mergedPath = path.join(tmpRoot, "merged.wav");
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:a",
      "pcm_s16le",
      "-ar",
      "44100",
      "-ac",
      "1",
      mergedPath,
    ]);

    const merged = await readFile(mergedPath);
    const totalMs =
      parts.reduce((acc, p) => acc + p.durationMs, 0) +
      Math.round(pauseSec * 1000) * (parts.length - 1);

    const mergedWords: TTSWord[] = [];
    let offsetMs = 0;
    for (let i = 0; i < parts.length; i++) {
      for (const w of parts[i]!.words) {
        mergedWords.push({
          text: w.text,
          startMs: w.startMs + offsetMs,
          endMs: w.endMs + offsetMs,
        });
      }
      offsetMs += parts[i]!.durationMs;
      if (i < parts.length - 1) offsetMs += Math.round(pauseSec * 1000);
    }

    return {
      audio: new Uint8Array(merged),
      durationMs: totalMs,
      words: mergedWords,
    };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function parseSubtitleToWords(subtitle: unknown): TTSWord[] {
  if (!Array.isArray(subtitle)) return [];
  return subtitle
    .filter(
      (
        e,
      ): e is {
        text?: unknown;
        offset?: unknown;
        duration?: unknown;
      } => typeof e === "object" && e !== null,
    )
    .map((e) => ({
      text: String(e.text ?? ""),
      startMs: Math.round(Number(e.offset ?? 0) / 10_000),
      endMs: Math.round(
        (Number(e.offset ?? 0) + Number(e.duration ?? 0)) / 10_000,
      ),
    }))
    .filter((w) => w.text.length > 0);
}

function estimateDurationMs(text: string, cps = 5): number {
  const chars = [...text].length;
  return Math.max(500, Math.round((chars / cps) * 1000));
}

/** Test-only factory — the real EdgeTTSProvider talks to Microsoft; we expose
 * a mock for vitest that returns canned bytes without network. The mock
 * honors `pauseBetweenSentencesSec` by padding its duration estimate so
 * downstream timing math still works (no ffmpeg concat — that's a real
 * provider concern). */
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
      const baseDurationMs = Math.max(500, Math.round((chars / cps) * 1000));
      // Approximate the extra silence the real provider would insert.
      const pause = req.pauseBetweenSentencesSec ?? 0;
      const sentences = pause > 0 ? splitSentences(req.text) : [];
      const extra = pause * 1000 * Math.max(0, sentences.length - 1);
      return {
        audio: new Uint8Array(opts.sampleBytes ?? 1024),
        durationMs: baseDurationMs + extra,
        words: [],
      };
    },
  };
}
