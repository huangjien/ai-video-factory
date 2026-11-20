import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, statSync } from "node:fs";
import { DOUYIN_HEIGHT, DOUYIN_WIDTH } from "./schemas.js";

const execFileAsync = promisify(execFile);

/**
 * The 16:9 → 9:16 cut.
 *
 * Douyin is a vertical platform: a landscape post arrives letterboxed and
 * reads as two different products. Two ways to get there, and only one of
 * them is honest:
 *
 *   - `crop`   — a centre crop. The frame FILLS the screen like a native
 *                vertical video, but it throws away ~43% of the width:
 *                side content, and the wider title-card type, are gone.
 *   - `inset`  — a blurred, scaled-up copy of the frame as the backdrop,
 *                with the whole 16:9 film centred on top of it. Nothing
 *                is cropped: the title cards, the captions and a borrowed
 *                archive picture all stay readable.
 *
 * `inset` is the default and the one this channel uses: these films are
 * explainers, and a cropped explainer loses the type.
 */
export type VerticalCutMode = "inset" | "crop";

export interface VerticalCutOptions {
  /** The rendered landscape master. */
  source: string;
  /** Where the vertical file is written. */
  out: string;
  mode?: VerticalCutMode | undefined;
  width?: number | undefined;
  height?: number | undefined;
  /** How blurred the backdrop is. Higher = softer, less distracting. */
  blurSigma?: number | undefined;
}

/**
 * The ffmpeg filter graph for the mode, as a `-filter_complex` body.
 *
 * It has to be filter_complex and not -vf: the inset mode takes the same
 * input twice (once for the backdrop, once for the foreground), and -vf
 * accepts a single input-to-output chain. The result is labelled `[v]`, and
 * the caller maps it.
 *
 * Exported so a test can assert on it without running ffmpeg.
 */
export function verticalFilter(
  mode: VerticalCutMode,
  width: number,
  height: number,
  blurSigma: number,
): string {
  if (mode === "crop") {
    // Centre crop to 9:16, then scale to the target frame.
    return `[0:v]crop=ih*9/16:ih,scale=${width}:${height}[v]`;
  }
  // The backdrop is the frame scaled to COVER the canvas and blurred; the
  // foreground is the frame scaled to fit the width, centred on top.
  return [
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height},gblur=sigma=${blurSigma}[bg]`,
    `[0:v]scale=${width}:-2[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`,
  ].join(";");
}

export class VerticalCutError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "VerticalCutError";
  }
}

/**
 * Render the vertical cut.
 *
 * The audio is copied as-is (the narration and BGM are already mixed), and
 * the file is faststarted so the app can stream it before the whole file
 * is downloaded — a 5-minute video that only starts after the whole
 * download is a video people do not finish.
 */
export async function cutVertical(opts: VerticalCutOptions): Promise<string> {
  if (!existsSync(opts.source)) {
    throw new VerticalCutError(`no source video at ${opts.source}`);
  }
  const width = opts.width ?? DOUYIN_WIDTH;
  const height = opts.height ?? DOUYIN_HEIGHT;
  const mode = opts.mode ?? "inset";
  const blurSigma = opts.blurSigma ?? 40;

  const args = [
    "-y",
    "-i",
    opts.source,
    "-filter_complex",
    verticalFilter(mode, width, height, blurSigma),
    "-map",
    "[v]",
    // The narration and BGM are already mixed in the master — copy them.
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    opts.out,
  ];
  try {
    await execFileAsync("ffmpeg", args, { maxBuffer: 1024 * 1024 * 16 });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    throw new VerticalCutError(
      `ffmpeg failed: ${stderr.split("\n").slice(-3).join(" ").slice(0, 300)}`,
      err,
    );
  }
  return opts.out;
}

/** The vertical cut already exists and is newer than the master? */
export function verticalCutIsFresh(
  out: string,
  source: string,
): boolean {
  if (!existsSync(out) || !existsSync(source)) return false;
  return statSync(out).mtimeMs >= statSync(source).mtimeMs;
}
