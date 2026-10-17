import type { Theme } from "../theme.js";
import { darkTechTheme } from "../theme.js";
import {
  CAPTION_FONT_RATIO,
  captionFontSize,
  captionTextStyle,
} from "../captionStyle.js";

export interface CaptionsOverlayProps {
  lines: string[];
  width: number;
  height: number;
  theme?: Theme;
}

/**
 * Burn-in caption track (plan §16 MVP-1: "Captions 可用"). Renders the
 * scene's wrapped caption lines at the bottom safe area — the lines come
 * from the compiled plan (CJK-aware wrapText, compile.ts), so this
 * component never re-wraps or truncates. Purely presentational: no
 * animation primitives, deterministic at any fps.
 *
 * No plate, and type at ~3.2% of frame height so the caption supports the
 * image instead of covering it. See `captionStyle.ts` for the legibility
 * treatment shared with `ImageBackground`.
 */

/** Distance from the bottom edge, as a fraction of frame height. */
const BOTTOM_RATIO = 0.055;

/** Widest a single caption line may run, as a fraction of frame width. */
const MAX_WIDTH_RATIO = 0.86;

export const CaptionsOverlay = ({
  lines,
  width,
  height,
  theme = darkTechTheme,
}: CaptionsOverlayProps) => {
  if (lines.length === 0) return null;
  const fontSize = captionFontSize(height);
  const bottom = Math.round(height * BOTTOM_RATIO);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: Math.round(fontSize * 0.3),
        pointerEvents: "none",
      }}
    >
      {lines.map((line, i) => (
        <div
          key={`${i}-${line.slice(0, 8)}`}
          style={{
            maxWidth: Math.round(width * MAX_WIDTH_RATIO),
            // Padding is inset only to give the outline room to render —
            // there is no plate behind it.
            padding: `${Math.round(fontSize * 0.1)}px ${Math.round(fontSize * 0.25)}px`,
            textAlign: "center",
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
