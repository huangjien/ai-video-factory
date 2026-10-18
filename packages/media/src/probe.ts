import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function probeAudioDuration(file: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const duration = Number.parseFloat(stdout.trim());
  if (Number.isNaN(duration)) {
    throw new Error(`ffprobe returned no duration for ${file}`);
  }
  return duration;
}

/** Nullable variant for advisory probing (library scans, tag
 * resolution, report lines): ffprobe missing or audio unreadable →
 * null instead of throwing. The mix paths that need a real number
 * (fade timestamps, apad targets) must use the throwing variant — a
 * NaN there poisons the whole filtergraph. */
export async function probeAudioDurationOrNull(
  file: string,
): Promise<number | null> {
  try {
    return await probeAudioDuration(file);
  } catch {
    return null;
  }
}
