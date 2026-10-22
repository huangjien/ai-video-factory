import type { Theme } from "../theme.js";
import { darkTechTheme } from "../theme.js";
import {
  CAPTION_FONT_RATIO,
  captionContainerStyle,
  captionFontSize,
  captionLineStyle,
  captionTextStyle,
} from "../captionStyle.js";

export interface CaptionCue {
  lines: string[];
  startSec: number;
  endSec: number;
  /** Phrases to render with a yellow-highlight background. Single list
   *  shared across all cues built in one call (per-scene highlight set). */
  markers?: string[];
}

export interface CaptionsOverlayProps {
  cues: CaptionCue[];
  /** Frame index within THIS scene (Root rebases per-scene renders to 0). */
  localFrame: number;
  fps: number;
  width: number;
  height: number;
  theme?: Theme;
}

/**
 * Burn-in caption track (plan §16 MVP-1: "Captions 可用"). Renders the
 * scene's timed caption cues at the bottom safe area — the cues come from
 * the compiled plan (CJK-aware split + wrap in @video/media), so this
 * component never re-wraps or truncates. Purely presentational: no
 * animation primitives, deterministic at any fps.
 *
 * CS-07: only the cue active at `localFrame` is drawn, so a caption is
 * never more than MAX_CAPTION_LINES rows tall no matter how long the
 * scene narration is. The cue shape is declared structurally rather than
 * imported — this package depends on @video/vdsl, not @video/media, and
 * the two are assignable.
 *
 * No plate, and type at ~3.2% of frame height so the caption supports the
 * image instead of covering it. See `captionStyle.ts` for the legibility
 * treatment shared with `ImageBackground`.
 */

/** Band geometry (bottom offset, max width, padding) lives in
 * `captionStyle.ts` — shared with `ImageBackground`'s own caption. */

/** Split a line into alternating runs of plain vs highlighted text. The
 *  earliest match in the remaining string wins at each step, so two
 *  markers that overlap are handled by greedy left-to-right scanning and
 *  longer markers don't get split when a shorter one happens to start
 *  inside them. Returns an array of `{ text, hi }` segments in source
 *  order; an empty marker list collapses to a single plain segment. */
function splitWithMarkers(
  line: string,
  markers: string[] | undefined,
): Array<{ text: string; hi: boolean }> {
  if (!markers || markers.length === 0 || line.length === 0) {
    return line.length === 0 ? [] : [{ text: line, hi: false }];
  }
  const segments: Array<{ text: string; hi: boolean }> = [];
  let remaining = line;
  while (remaining.length > 0) {
    let earliest: { idx: number; len: number } | undefined;
    for (const m of markers) {
      if (m.length === 0) continue;
      const idx = remaining.indexOf(m);
      if (idx < 0) continue;
      if (earliest === undefined || idx < earliest.idx) {
        earliest = { idx, len: m.length };
      }
    }
    if (earliest === undefined) {
      segments.push({ text: remaining, hi: false });
      break;
    }
    if (earliest.idx > 0) {
      segments.push({ text: remaining.slice(0, earliest.idx), hi: false });
    }
    segments.push({
      text: remaining.slice(earliest.idx, earliest.idx + earliest.len),
      hi: true,
    });
    remaining = remaining.slice(earliest.idx + earliest.len);
  }
  return segments;
}

export const CaptionsOverlay = ({
  cues,
  localFrame,
  fps,
  width,
  height,
  theme = darkTechTheme,
}: CaptionsOverlayProps) => {
  if (cues.length === 0) return null;
  const sec = fps > 0 ? localFrame / fps : 0;
  // The last cue absorbs the final frame so the caption does not blink out
  // one frame before the scene cuts.
  const cue = (
    cues.find((c) => sec >= c.startSec && sec < c.endSec) ??
    cues[cues.length - 1]
  )!;
  if (cue.lines.length === 0) return null;
  const fontSize = captionFontSize(height);
  const lineBaseStyle = {
    ...captionLineStyle(width, height),
    ...captionTextStyle(theme, fontSize),
  };
  return (
    <div style={captionContainerStyle(height)}>
      {cue.lines.map((line, i) => {
        const segments = splitWithMarkers(line, cue.markers);
        if (segments.length === 0) return null;
        return (
          <div key={`${i}-${line.slice(0, 8)}`} style={lineBaseStyle}>
            {segments.map((seg, j) =>
              seg.hi ? (
                <span
                  key={`${i}-${j}`}
                  style={{
                    background: "#FFE8A1",
                    color: "#1a1a1a",
                    padding: "0 6px",
                    margin: "0 1px",
                    borderRadius: 3,
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.06)",
                    textShadow: "none",
                  }}
                >
                  {seg.text}
                </span>
              ) : (
                <span key={`${i}-${j}`}>{seg.text}</span>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
};

export { CAPTION_FONT_RATIO };
