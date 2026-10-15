/**
 * Shared CLI markers + a small "channel home" header helper.
 *
 * Goal: keep the same Unicode across `video new / make / status /
 * workflow / qa …` so the operator learns one glyph vocabulary. Symbols
 * are chosen to read as creator/playback cues (▷ play, ✓ ok, ✗ fail, !
 * warn, ⏭ skip, ○ not-started, ● current).
 *
 * Rule: this file must never own business logic — it formats strings
 * only. Each command stays responsible for its own copy.
 */
import type { ProgressEvent } from "@video/make";
import { heartbeat } from "@video/make";
import { VERSION } from "./version.js";

export const MARK_OK = "✓"; // ran / approved
export const MARK_FAIL = "✗"; // failed / rejected / invalidated
export const MARK_WARN = "!"; // warn-level QA finding
export const MARK_SKIP = "⏭"; // skipped / up-to-date
export const MARK_RUN = "▷"; // play-indicator (run / would-run)
export const MARK_TODO = "○"; // not-yet-started checkpoint
export const MARK_NOW = "●"; // currently-active stage / pipeline point
export const MARK_WAIT = "⏳"; // alive, waiting on one long call (video-progress/1)

/**
 * One-line channel-home header for `video status` and similar.
 * `name` is the project slug (channel); `state` is e.g. "storyboard".
 *
 * Output:
 *   ▶ my-channel  ·  storyboard
 *   A I   V I D E O   F A C T O R Y   ·   v0.4
 */
export function channelHeader(name: string, state: string): string {
  return `${MARK_RUN} ${name}  ·  ${state}`;
}

export function brandBannerLine(): string {
  return `A I   V I D E O   F A C T O R Y   ·   v${VERSION}`;
}

/**
 * Small status row used by `video status`. Mark + label + optional
 * detail line under; keeps the timeline tidy and grep-friendly.
 */
export function statusLine(mark: string, label: string): string {
  return `${mark} ${label}`;
}

/**
 * video-progress/1 (v0.7.1) — live pipeline progress on stderr.
 *
 * `formatProgressEvent` renders one ProgressEvent as a line in the §3
 * vocabulary (plan: docs/v0.7.1-progress-plan.md):
 *   ▶ tts                    step/item start
 *   ✓ [3/23] tts scene_03  4s   item done with position + elapsed
 *   ⏳ generate-visuals … 95s    heartbeat (alive, waiting on one call)
 *   ✗ tts scene_07  12s: …    failure (live; the final report still records it)
 *
 * `withProgress` wraps one long call with start/done/fail + heartbeat
 * lines for callers without an event sink (draft's web search, article
 * call, audio-plan). Everything prints to stderr — stdout stays
 * artifact-clean.
 */

function position(e: ProgressEvent): string {
  return e.index !== undefined ? ` [${e.index}/${e.total}]` : "";
}

export function formatProgressEvent(e: ProgressEvent): string {
  switch (e.kind) {
    case "start":
      return `  ${MARK_RUN}${position(e)} ${e.label}`;
    case "done":
      return `  ${MARK_OK}${position(e)} ${e.label}  ${e.elapsedSec ?? 0}s`;
    case "fail":
      return `  ${MARK_FAIL}${position(e)} ${e.label}  ${e.elapsedSec ?? 0}s: ${(e.message ?? "").slice(0, 80)}`;
    case "heartbeat":
      return `  ${MARK_WAIT} ${e.label} … ${e.elapsedSec ?? 0}s`;
  }
}

/** Run one long call with live stderr progress (start/done/fail +
 * heartbeats). Rejects with the wrapped call's error. */
export async function withProgress<T>(
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  const emit = (e: ProgressEvent) => console.error(formatProgressEvent(e));
  emit({ kind: "start", label });
  const t0 = Date.now();
  try {
    const value = await heartbeat(label, run, emit);
    emit({
      kind: "done",
      label,
      elapsedSec: Math.round((Date.now() - t0) / 1000),
    });
    return value;
  } catch (err) {
    emit({
      kind: "fail",
      label,
      elapsedSec: Math.round((Date.now() - t0) / 1000),
      message: (err as Error).message,
    });
    throw err;
  }
}
