import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface MixOptions {
  narrationPaths: string[];
  bgmPath: string;
  outPath: string;
  bgmAttenuationDb?: number;
  duckerThresholdDb?: number;
}

export interface MixResult {
  outPath: string;
}

/**
 * Mix per-scene narration WAVs with a single BGM track into one container.
 *
 * Approach:
 *   1) Concatenate all narrations into one WAV via the ffmpeg `concat`
 *      demuxer driven by a pre-written list-file (the pipe-separated
 *      "file a|file b" syntax doesn't work in ffmpeg 9.x — it treats the
 *      whole thing as one input path).
 *   2) Mix that concatenated narration with the BGM using `amix` plus a
 *      `sidechaincompress` keyed off the narration — the BGM is
 *      pre-attenuated ~-18 dB and ducks further whenever narration is
 *      speaking. Soundscape stays audible between lines; voice stays on top.
 *
 * v0.3.4 ships BGM-only mixing. SFX cueing requires a scene-to-cue mapping
 * convention (deferred).
 */
export async function mixTracks(opts: MixOptions): Promise<MixResult> {
  if (opts.narrationPaths.length === 0) {
    throw new Error("at least one narration path is required");
  }
  await mkdir(path.dirname(opts.outPath), { recursive: true });
  const bgmAttenuationDb = opts.bgmAttenuationDb ?? -18;
  const duckerThresholdDb = opts.duckerThresholdDb ?? 0.05;
  const bgmLinear = dbToLinear(bgmAttenuationDb);

  const tmpDir = await mkdtemp(path.join(path.dirname(opts.outPath), ".mix-"));
  const listFile = path.join(tmpDir, "list.txt");
  const tmpNarration = path.join(tmpDir, "narration.wav");
  await writeFile(
    listFile,
    opts.narrationPaths
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join("\n"),
    "utf8",
  );
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-ar",
    "44100",
    "-ac",
    "1",
    tmpNarration,
  ]);

  const filter = [
    "[0:a]aresample=44100[n]",
    `[1:a]aresample=44100,volume=${bgmLinear}[bgm_pre]`,
    `[bgm_pre][n]sidechaincompress=threshold=${duckerThresholdDb}:ratio=8:attack=5:release=400[bgm]`,
    "[n][bgm]amix=inputs=2:duration=longest:dropout_transition=0[out]",
  ].join(";");
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    tmpNarration,
    "-i",
    opts.bgmPath,
    "-filter_complex",
    filter,
    "-map",
    "[out]",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    opts.outPath,
  ]);
  await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  return { outPath: opts.outPath };
}

function dbToLinear(db: number): string {
  return String(Math.pow(10, db / 20));
}
