import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Scene geometry — the films render 1920×1080 landscape and the vertical
 *  workdir re-renders 1080×1920; archival footage must fill a 9:16 frame
 *  either way, so the preprocess target is the portrait one. */
export const CLIP_WIDTH = 1080;
export const CLIP_HEIGHT = 1920;
export const CLIP_FPS = 30;

export interface PreprocessClipOptions {
  /** Source clip — any container/geometry ffmpeg reads (PD archival
   *  footage is typically 4:3 landscape, 24–30fps, with audio). */
  input: string;
  /** Output path — the pipeline writes `assets/video/scene_N.mp4`. */
  output: string;
  /** Trim the clip to this many seconds (the scene's rendered
   *  duration, from readSceneTimings). 0 or undefined = keep full
   *  length (hand-placed clips may already be cut). */
  durationSec?: number | undefined;
  /** Fit mode — "cover" center-crops (default; loses the frame edges
   *  of 4:3 material but fills a 9:16 phone screen), "contain"
   *  letterboxes instead (not used by the pipeline in v1). */
  fit?: "cover" | "contain" | undefined;
}

/**
 * Normalize a public-domain clip into a scene background, deterministically:
 *
 * - cover-crop to 1080×1920 (a 4:3 newsreel loses its side edges; the
 *   phone-format film has no other honest option in v1)
 * - audio STRIPPED — narration and BGM own the soundtrack; archival
 *   audio (muffled narration, hiss) has no place in the mix
 * - 30 fps h264 yuv420p, faststart — matches the render pipeline's
 *   concat-compatible geometry
 * - trimmed to the scene duration so OffthreadVideo never runs past
 *   the clip's end mid-scene
 */
export async function preprocessClip(
  opts: PreprocessClipOptions,
): Promise<void> {
  const fit = opts.fit ?? "cover";
  const filter =
    fit === "cover"
      ? `scale=${CLIP_WIDTH}:${CLIP_HEIGHT}:force_original_aspect_ratio=increase,crop=${CLIP_WIDTH}:${CLIP_HEIGHT},fps=${CLIP_FPS}`
      : `scale=${CLIP_WIDTH}:${CLIP_HEIGHT}:force_original_aspect_ratio=decrease,pad=${CLIP_WIDTH}:${CLIP_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=${CLIP_FPS}`;
  await mkdir(path.dirname(opts.output), { recursive: true });
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    opts.input,
    ...(opts.durationSec && opts.durationSec > 0
      ? ["-t", String(opts.durationSec)]
      : []),
    "-vf",
    filter,
    // Archival audio is never used — the scene's narration and BGM
    // carry the soundtrack.
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    opts.output,
  ]);
}
