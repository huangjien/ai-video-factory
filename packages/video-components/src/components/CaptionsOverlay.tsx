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
  return (
    <div style={captionContainerStyle(height)}>
      {cue.lines.map((line, i) => (
        <div
          key={`${i}-${line.slice(0, 8)}`}
          style={{
            ...captionLineStyle(width, height),
            ...captionTextStyle(theme, fontSize),
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
};

export { CAPTION_FONT_RATIO };
