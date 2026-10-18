import type { Theme } from "../theme.js";
import { darkTechTheme } from "../theme.js";
import {
  CAPTION_FONT_RATIO,
  captionContainerStyle,
  captionFontSize,
  captionLineStyle,
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

/** Band geometry (bottom offset, max width, padding) lives in
 * `captionStyle.ts` — shared with `ImageBackground`'s own caption. */

export const CaptionsOverlay = ({
  lines,
  width,
  height,
  theme = darkTechTheme,
}: CaptionsOverlayProps) => {
  if (lines.length === 0) return null;
  const fontSize = captionFontSize(height);
  return (
    <div style={captionContainerStyle(height)}>
      {lines.map((line, i) => (
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
