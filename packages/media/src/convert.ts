import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Convert mp3 bytes (from TTS) to 44.1 kHz mono WAV, padding to
 * `minDurationSec` total when the narration is shorter. Never truncates:
 * `apad=whole_dur` only tops up to the minimum, so a narration that runs
 * longer than the article's estimate survives intact (the LLM routinely
 * underestimates) and syncSceneDurations rewrites the storyboard to the
 * measured length.
 *
 * Shared by @video/make (runTts) and @video/cli (runAudio). The two
 * private copies were byte-identical and kept apart only by a
 * would-be circular import — @video/media is imported by both, so the
 * helper lives here. */
export async function mp3ToWav(
  mp3Bytes: Uint8Array,
  minDurationSec: number,
): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), "video-tts-convert-"));
  try {
    const inPath = path.join(dir, "in.mp3");
    const outPath = path.join(dir, "out.wav");
    await writeFile(inPath, mp3Bytes);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inPath,
      "-ar",
      "44100",
      "-ac",
      "1",
      "-af",
      `apad=whole_dur=${minDurationSec}`,
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
