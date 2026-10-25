import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TTSError, type TTSProvider, type TTSRequest, type TTSResult } from "./provider.js";

/** Default interpreter: a uv venv at ~/.venvs/f5tts with the pinned
 *  dependency set (f5-tts-mlx 0.2.6 + mlx 0.29.x — mlx 0.32 breaks
 *  mx.random.normal's shape handling inside cfm.sample). Override with
 *  F5TTS_PYTHON. */
const DEFAULT_PYTHON = `${process.env.HOME}/.venvs/f5tts/bin/python`;
/** Default reference clip: the narrator-zh voice, cut from a shipped
 *  scene's voicebox WAV so the timbre matches the historical voice. */
const DEFAULT_REF_AUDIO = `${process.env.HOME}/.f5tts/narrator-zh-ref.wav`;

/** Reference transcripts live in a `.txt` sidecar next to the clip —
 *  F5 aligns the clone to this text, so it must transcribe the clip. */
function refTextPath(refAudio: string): string {
  return refAudio.replace(/\.wav$/i, ".txt");
}

/** python -c driver: reads one JSON config on stdin, synthesizes, and
 *  writes a `.json` sidecar with the exact WAV duration. generate()
 *  prints progress to stdout, so the metadata goes to a file, not the
 *  pipe. Kept as a literal (not a shipped script) so the provider stays
 *  one file. */
const PYTHON_DRIVER = `
import json, sys, wave
cfg = json.loads(sys.stdin.read())
from f5_tts_mlx.generate import generate
generate(
    generation_text=cfg["text"],
    model_name=cfg["model"],
    ref_audio_path=cfg["ref_audio"],
    ref_audio_text=cfg["ref_text"],
    steps=cfg["steps"],
    method=cfg["method"],
    estimate_duration=True,
    output_path=cfg["out_wav"],
)
w = wave.open(cfg["out_wav"])
meta = {"duration_sec": w.getnframes() / w.getframerate(), "sample_rate": w.getframerate()}
with open(cfg["out_json"], "w") as f:
    json.dump(meta, f)
`;

export interface F5GenConfig {
  text: string;
  ref_audio: string;
  ref_text: string;
  model: string;
  steps: number;
  method: string;
  out_wav: string;
  out_json: string;
}

export type F5Runner = (
  pythonPath: string,
  driver: string,
  config: F5GenConfig,
  timeoutMs: number,
) => Promise<void>;

export interface F5TTSProviderOptions {
  pythonPath?: string;
  refAudioPath?: string;
  model?: string;
  steps?: number;
  method?: string;
  timeoutMs?: number;
  /** Test seam: replace the python/ffmpeg spawns. */
  run?: F5Runner;
  /** Test seam: replace the ffmpeg resample of the reference clip. */
  resample?: (src: string, dst: string) => Promise<void>;
}

/** Probe the F5-TTS (MLX) install: interpreter + package + reference clip.
 *  Cheap static checks plus one import — ~1-2s, run once per make. */
const PYTHON_PROBE = "import f5_tts_mlx.generate";
export async function f5ttsStatus(opts: {
  pythonPath?: string;
  refAudioPath?: string;
  run?: F5Runner;
} = {}): Promise<{
  available: boolean;
  refAudio: string;
  refText: string;
  reason?: string;
}> {
  const pythonPath = opts.pythonPath ?? process.env.F5TTS_PYTHON ?? DEFAULT_PYTHON;
  const refAudio = opts.refAudioPath ?? process.env.F5TTS_REF_WAV ?? DEFAULT_REF_AUDIO;
  const refText = refTextPath(refAudio);
  if (!existsSync(pythonPath)) {
    return { available: false, refAudio, refText, reason: `interpreter missing: ${pythonPath}` };
  }
  if (!existsSync(refAudio) || !existsSync(refText)) {
    return {
      available: false,
      refAudio,
      refText,
      reason: `reference clip/transcript missing under ${refAudio}`,
    };
  }
  const run =
    opts.run ??
    ((py, driver, _cfg, timeoutMs) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(py, ["-c", driver], { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr?.on("data", (d) => (stderr += String(d)));
        const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
        child.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          code === 0
            ? resolve()
            : reject(new Error(`import probe exit ${code}: ${stderr.slice(0, 200)}`));
        });
      }));
  try {
    await run(pythonPath, PYTHON_PROBE, {
      text: "",
      ref_audio: "",
      ref_text: "",
      model: "",
      steps: 0,
      method: "",
      out_wav: "",
      out_json: "",
    }, 15000);
    return { available: true, refAudio, refText };
  } catch (err) {
    return {
      available: false,
      refAudio,
      refText,
      reason: `package import failed: ${(err as Error).message.slice(0, 200)}`,
    };
  }
}

export class F5TTSProvider implements TTSProvider {
  readonly name = "f5tts";
  private readonly pythonPath: string;
  private readonly refAudioPath: string;
  private readonly model: string;
  private readonly steps: number;
  private readonly method: string;
  private readonly timeoutMs: number;
  private readonly run: F5Runner;
  private readonly resample: (src: string, dst: string) => Promise<void>;

  constructor(opts: F5TTSProviderOptions = {}) {
    this.pythonPath = opts.pythonPath ?? process.env.F5TTS_PYTHON ?? DEFAULT_PYTHON;
    this.refAudioPath = opts.refAudioPath ?? process.env.F5TTS_REF_WAV ?? DEFAULT_REF_AUDIO;
    this.model = opts.model ?? "lucasnewman/f5-tts-mlx";
    // Quality baseline (2026-10-25 user A/B): steps=6 + rk4 ACCEPTED
    // (RTF 2.16, w6-s6-rk4.wav); steps=4 midpoint rejected for quality;
    // steps=8 rk4 accepted but no faster than voicebox. Full matrix in
    // the run log: s8 midpoint RTF 1.54 · s6 midpoint RTF 1.11 ·
    // s8 quant-8 RTF 3.59 (slower — quantization is a dead end here).
    // Tune without code via F5TTS_STEPS / F5TTS_METHOD.
    this.steps = opts.steps ?? Number(process.env.F5TTS_STEPS ?? 6);
    this.method = opts.method ?? process.env.F5TTS_METHOD ?? "rk4";
    this.timeoutMs = opts.timeoutMs ?? 300_000;
    this.run =
      opts.run ??
      ((py, driver, config, timeoutMs) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(py, ["-c", driver], { stdio: ["pipe", "ignore", "pipe"] });
          let stderr = "";
          child.stdin.write(JSON.stringify(config));
          child.stdin.end();
          child.stderr?.on("data", (d) => (stderr += String(d)));
          const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
          child.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
          });
          child.on("close", (code) => {
            clearTimeout(timer);
            code === 0
              ? resolve()
              : reject(
                  new Error(`exit ${code}: ${stderr.slice(-400).trim() || "(no stderr)"}`),
                );
          });
        }));
    this.resample = opts.resample ?? this.resampleWithFfmpeg;
  }

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    if (req.text.trim().length === 0) {
      throw new TTSError("empty narration text", this.name);
    }
    // Voice may be an explicit reference-clip path (project picks another
    // timbre); otherwise the shared narrator reference. A `.txt` sidecar
    // with the clip transcript must exist either way.
    let refAudio = this.refAudioPath;
    if (/\.wav$/i.test(req.voice) && existsSync(req.voice)) {
      refAudio = req.voice;
    }
    const refText = refTextPath(refAudio);
    if (!existsSync(refAudio)) {
      throw new TTSError(`reference clip missing: ${refAudio}`, this.name);
    }
    if (!existsSync(refText)) {
      throw new TTSError(
        `reference transcript missing: ${refText} (F5 aligns the clone to this text)`,
        this.name,
      );
    }

    const workDir = await mkdtemp(join(tmpdir(), "f5tts-"));
    try {
      // generate() requires a 24 kHz reference — always funnel the clip
      // through ffmpeg (no-op cost when already 24k) instead of probing.
      const ref24k = join(workDir, "ref24k.wav");
      await this.resample(refAudio, ref24k);
      const refTextInput = (await readFile(refText, "utf8")).trim();

      const outWav = join(workDir, "out.wav");
      const outJson = `${outWav}.json`;
      const config: F5GenConfig = {
        text: req.text,
        ref_audio: ref24k,
        ref_text: refTextInput,
        model: this.model,
        steps: this.steps,
        method: this.method,
        out_wav: outWav,
        out_json: outJson,
      };
      try {
        await this.run(this.pythonPath, PYTHON_DRIVER, config, this.timeoutMs);
      } catch (err) {
        throw new TTSError(`F5-TTS synthesis failed: ${(err as Error).message}`, this.name);
      }
      const audio = await readFile(outWav);
      const meta = JSON.parse(await readFile(outJson, "utf8")) as {
        duration_sec: number;
      };
      return {
        audio: new Uint8Array(audio),
        durationMs: Math.round(meta.duration_sec * 1000),
        // No word timestamps from F5 — the captions track falls back to
        // timed whole-line cues.
        words: [],
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private resampleWithFfmpeg(src: string, dst: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-i",
        src,
        "-t",
        "15",
        "-ar",
        "24000",
        "-ac",
        "1",
        dst,
      ]);
      let stderr = "";
      child.stderr?.on("data", (d) => (stderr += String(d)));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new TTSError(`reference resample failed: ${stderr.slice(-200)}`, this.name)),
      );
    });
  }
}
