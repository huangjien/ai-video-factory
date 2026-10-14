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
import { VERSION } from "./version.js";

export const MARK_OK = "✓"; // ran / approved
export const MARK_FAIL = "✗"; // failed / rejected / invalidated
export const MARK_WARN = "!"; // warn-level QA finding
export const MARK_SKIP = "⏭"; // skipped / up-to-date
export const MARK_RUN = "▷"; // play-indicator (run / would-run)
export const MARK_TODO = "○"; // not-yet-started checkpoint
export const MARK_NOW = "●"; // currently-active stage / pipeline point

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
