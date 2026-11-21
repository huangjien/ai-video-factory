import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Geometry + duration + audio presence of a video file — the checks the
 *  VDSL validator runs on a scene clip (1080×1920, no audio track,
 *  covers the scene). */
export interface VideoProbeMeta {
  width: number;
  height: number;
  durationSec: number;
  hasAudio: boolean;
}

/** Null when ffprobe cannot read the file — the validator treats that as
 *  an error-level finding, but the probe itself never throws so the
 *  message stays in one place. */
export async function probeVideoMetaOrNull(
  file: string,
): Promise<VideoProbeMeta | null> {
  try {
    const stdout = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=index,codec_type,width,height",
      "-of",
      "json",
      file,
    ]);
    const parsed = JSON.parse(stdout.stdout) as {
      streams?: {
        index: number;
        codec_type?: string;
        width?: number;
        height?: number;
      }[];
      format?: { duration?: string };
    };
    const video = parsed.streams?.find((s) => s.codec_type === "video");
    const durationStr = parsed.format?.duration;
    const durationSec =
      durationStr !== undefined ? Number.parseFloat(durationStr) : Number.NaN;
    if (
      video?.width === undefined ||
      video.height === undefined ||
      Number.isNaN(durationSec)
    ) {
      return null;
    }
    return {
      width: video.width,
      height: video.height,
      durationSec,
      hasAudio: (parsed.streams ?? []).some((s) => s.codec_type === "audio"),
    };
  } catch {
    return null;
  }
}

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
