import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type {
  TTSProvider,
  TTSRequest,
  TTSResult,
  TTSWord,
} from "./provider.js";
import { TTSError } from "./provider.js";

const execFileAsync = promisify(execFile);

export interface EdgeTTSProviderOptions {
  /** Prosody: rate, volume, pitch (SSML-style strings, e.g. "+10%"). */
  rate?: string;
  volume?: string;
  pitch?: string;
  /** When WordBoundary events are unavailable (rare), estimate duration from this char rate. */
  charsPerSecond?: number;
  /** Command that runs the python worker (default `uv run python tts_worker.py`). */
  pythonBin?: string;
  pythonArgs?: string[];
}

/**
 * Microsoft Edge online TTS adapter via the Python `edge-tts` sidecar
 * (`../python/tts_worker.py`). No API key. May rate-limit or fail
 * without network — callers must handle TTSError gracefully.
 *
 * Why a Python sidecar: the JS `edge-tts-universal` 1.4.0 hangs against
 * Microsoft's current endpoint (silent retry during the DRM-token
 * handshake — verified 2026-10-14: constructor OK, synthesize() never
 * settles). The Python `edge-tts` package is the reference
 * implementation and works. TTS has no model load (~1 s per call), so
 * a per-call subprocess is fine — unlike the flux worker, no warm
 * daemon is needed.
 *
 * `pauseBetweenSentencesSec` is honored via post-processing:
 * split into sentences, synthesize each separately, ffmpeg-concat with
 * literal silence gaps (Edge SSML `<break>` tags get read aloud).
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
    const pythonDir = resolvePythonDir();
    if (!existsSync(path.join(pythonDir, "tts_worker.py"))) {
      throw new TTSError(
        `python sidecar not found at ${pythonDir} — run uv sync in packages/tts/python/`,
        this.name,
      );
    }
    const tmp = await mkdtemp(path.join(tmpdir(), "video-tts-"));
    try {
      const mp3Path = path.join(tmp, "out.mp3");
      const request = JSON.stringify({
        text,
        voice,
        ...(this.opts.rate !== undefined ? { rate: this.opts.rate } : {}),
        ...(this.opts.volume !== undefined ? { volume: this.opts.volume } : {}),
        ...(this.opts.pitch !== undefined ? { pitch: this.opts.pitch } : {}),
        output: mp3Path,
      });
      const bin = this.opts.pythonBin ?? "uv";
      const args = [
        ...(this.opts.pythonArgs ?? ["run", "python", "tts_worker.py"]),
      ];
      const proc = spawnSync(bin, args, {
        cwd: pythonDir,
        input: request,
        encoding: "utf8",
        timeout: 120_000,
      });
      if (proc.error) {
        throw new TTSError(
          `edge tts worker failed to spawn ${bin} (${proc.error.message}) — install uv (https://github.com/astral-sh/uv) and run uv sync in packages/tts/python/`,
          this.name,
        );
      }
      const outLine = (proc.stdout ?? "").trim().split("\n").pop() ?? "";
      let parsed: {
        ok?: boolean;
        error?: string;
        durationMs?: number;
        words?: TTSWord[];
      };
      try {
        parsed = JSON.parse(outLine) as typeof parsed;
      } catch {
        throw new TTSError(
          `edge tts worker returned no JSON (exit ${proc.status}) — ${(proc.stderr ?? "").trim().slice(-200)}`,
          this.name,
        );
      }
      if (proc.status !== 0 || parsed.ok !== true) {
        throw new TTSError(
          `edge tts failed: ${parsed.error ?? `exit ${proc.status}`}`,
          this.name,
        );
      }
      const audio = new Uint8Array(await readFile(mp3Path));
      const words = parsed.words ?? [];
      const durationMs =
        words.length > 0
          ? (words[words.length - 1]?.endMs ?? 0)
          : (parsed.durationMs && parsed.durationMs > 0
            ? parsed.durationMs
            : estimateDurationMs(text, this.opts.charsPerSecond));
      return { audio, durationMs, words };
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** packages/tts/{dist|src} → ../python (same either way). */
function resolvePythonDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "python");
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
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "video-tts-pause-"));
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
