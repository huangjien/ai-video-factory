import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Multi-BGM timeline (branding feature 2026-10-05). `audio-config.yaml`
 * `bgm_tracks` declares ordered windows in absolute video seconds (the
 * intro can carry a different mood than the body). This module plans the
 * windows and pre-renders them into ONE wav with crossfades, which is then
 * handed to the existing single-`--bgm` mix path — the ducker, master
 * fades and amix in mix.ts stay untouched.
 */

export interface BgmTrackInput {
  /** Named tag (assets/audio-assets/bgm/<tag>.wav) or absolute/relative
   * file path. Resolution to a real path is the caller's job. */
  track: string;
  /** Window end in absolute seconds; omitted = runs to the end. */
  until_sec?: number;
}

export interface BgmWindow {
  /** Resolved audio file for this window. */
  path: string;
  startSec: number;
  endSec: number;
}

export class BgmTimelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BgmTimelineError";
  }
}

/** Cut the ordered track list into contiguous windows covering [0, total].
 * Validation errors are loud: an ascending-until requirement the user can
 * reason about beats silently shuffling their music. */
export function planBgmWindows(
  tracks: BgmTrackInput[],
  totalSec: number,
  resolvePath: (track: string) => string,
): BgmWindow[] {
  if (tracks.length === 0) {
    throw new BgmTimelineError("bgm_tracks is empty");
  }
  const windows: BgmWindow[] = [];
  let cursor = 0;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i]!;
    const last = i === tracks.length - 1;
    let end: number;
    if (t.until_sec === undefined) {
      if (!last) {
        throw new BgmTimelineError(
          `bgm_tracks[${i}] ("${t.track}") omits until_sec — only the LAST entry may run to the end`,
        );
      }
      end = totalSec;
    } else {
      if (t.until_sec <= cursor) {
        throw new BgmTimelineError(
          `bgm_tracks[${i}] until_sec=${t.until_sec} must be greater than the previous window end (${cursor}s)`,
        );
      }
      end = t.until_sec;
    }
    windows.push({
      path: resolvePath(t.track),
      startSec: cursor,
      endSec: Math.min(end, totalSec),
    });
    cursor = end;
    if (cursor >= totalSec) break;
  }
  // Clamp: a trailing window that starts past the narration end still gets
  // trimmed to zero by ffmpeg's atrim — drop it here instead.
  return windows.filter((w) => w.endSec > w.startSec);
}

export interface TimelineFilterOptions {
  /** Crossfade between adjacent windows (also the per-window edge fade). */
  crossfadeSec?: number;
  sampleRate?: number;
}

/** Build the ffmpeg invocation that concatenates the windows into one
 * wav: each source is looped (short generated beds), trimmed to its
 * window, edge-faded, then concat'ed. Pure string building — unit-tested
 * without ffmpeg. */
export function buildBgmTimelineArgs(
  windows: BgmWindow[],
  outPath: string,
  opts: TimelineFilterOptions = {},
): { args: string[]; filter: string } {
  if (windows.length === 0) {
    throw new BgmTimelineError("no bgm windows to render");
  }
  const xf = Math.max(0, opts.crossfadeSec ?? 1);
  const sr = opts.sampleRate ?? 44100;
  const args: string[] = ["-y"];
  const chains: string[] = [];
  const labels: string[] = [];
  windows.forEach((w, i) => {
    const dur = w.endSec - w.startSec;
    // -stream_loop before -i: a bed shorter than its window repeats.
    args.push("-stream_loop", "-1", "-i", w.path);
    const fadeIn = i === 0 ? 0 : xf;
    const fadeOut = i === windows.length - 1 ? 0 : xf;
    const parts = [
      `aresample=${sr}`,
      "aformat=sample_fmts=fltp:channel_layouts=stereo",
      `atrim=duration=${dur.toFixed(3)}`,
    ];
    if (fadeIn > 0 && dur > fadeIn) parts.push(`afade=in:st=0:d=${fadeIn}`);
    if (fadeOut > 0 && dur > fadeOut) {
      parts.push(`afade=out:st=${(dur - fadeOut).toFixed(3)}:d=${fadeOut}`);
    }
    // apad guarantees the exact window length even if the source is short
    // and stream_loop off-by-ones — concat needs identical-length inputs.
    parts.push(`apad=whole_dur=${dur.toFixed(3)}`);
    chains.push(`[${i}:a]${parts.join(",")}[as${i}]`);
    labels.push(`[as${i}]`);
  });
  chains.push(`${labels.join("")}concat=n=${windows.length}:v=0:a=1[out]`);
  const filter = chains.join(";");
  args.push("-filter_complex", filter, "-map", "[out]", outPath);
  return { args, filter };
}

/** Render the window plan to a single wav (the file handed to `video mix`
 * as `--bgm`). Writes next to the project's own bgm assets by default. */
export async function renderBgmTimeline(
  windows: BgmWindow[],
  outPath: string,
  opts: TimelineFilterOptions = {},
): Promise<string> {
  const { args } = buildBgmTimelineArgs(windows, outPath, opts);
  await mkdir(path.dirname(outPath), { recursive: true });
  await execFileAsync("ffmpeg", args);
  return outPath;
}
