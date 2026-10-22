import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** How much silence the `minDurationSec` floor may still inject.
 *
 * The floor exists for a real reason: `apad=whole_dur` only ever tops UP,
 * so a narration that runs longer than the estimate survives intact and
 * syncSceneDurations rewrites the storyboard to the measured length. The
 * LLM routinely underestimates, and that must keep working.
 *
 * But an over-estimate is silently destructive. A stale duration (left
 * over from a different voice, a speed change, or a provider swap) once
 * padded 264 s of dead air across a 17-scene film — 26% of the runtime —
 * with nothing in the log. The narration is authoritative; the estimate
 * is a floor for small misses only. */
export const MAX_TOP_UP_SEC = 2;

/** Measured length of an audio file, or null if ffprobe can't read it. */
async function probeDurationSec(file: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    const n = Number.parseFloat(stdout.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Convert mp3 bytes (from TTS) to 44.1 kHz mono WAV, padding to
 * `minDurationSec` total when the narration is shorter — but only by up
 * to `maxTopUpSec`. Never truncates: `apad=whole_dur` only tops up, so a
 * narration longer than the estimate survives intact and
 * syncSceneDurations rewrites the storyboard to the measured length.
 *
 * When the narration is more than `maxTopUpSec` shorter than the floor,
 * the estimate is stale rather than approximate, and the audio is
 * trusted as-is: padding it out would inject silence the voice never
 * asked for.
 *
 * Shared by @video/make (runTts) and @video/cli (runAudio). The two
 * private copies were byte-identical and kept apart only by a
 * would-be circular import — @video/media is imported by both, so the
 * helper lives here. */
export async function mp3ToWav(
  mp3Bytes: Uint8Array,
  minDurationSec: number,
  maxTopUpSec: number = MAX_TOP_UP_SEC,
): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), "video-tts-convert-"));
  try {
    const inPath = path.join(dir, "in.mp3");
    const outPath = path.join(dir, "out.wav");
    await writeFile(inPath, mp3Bytes);
    const narrationSec = await probeDurationSec(inPath);
    // Unprobeable audio keeps the old floor: a failed probe must not
    // silently disable padding, which runAudio's callers rely on.
    const floor =
      narrationSec !== null && narrationSec + maxTopUpSec < minDurationSec
        ? narrationSec
        : minDurationSec;
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inPath,
      "-ar",
      "44100",
      "-ac",
      "1",
      "-af",
      `apad=whole_dur=${floor}`,
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}