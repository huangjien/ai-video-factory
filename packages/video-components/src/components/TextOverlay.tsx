import type { FC } from "react";
import type { Theme } from "../theme.js";
import { darkTechTheme } from "../theme.js";

export interface TextOverlayProps {
  theme?: Theme;
  /** The film's title — sits in the opening shot's quiet area and fades. */
  title?: string | undefined;
  /** An optional chapter name, shown only where a section turn earns one. */
  chapter?: string | undefined;
  /** Where the block sits inside the frame's safe area. */
  position?: "top" | "bottom";
  /** Scene-relative seconds. The overlay is visible inside this window. */
  startSec: number;
  endSec: number;
  /** Scene-relative seconds elapsed. */
  sceneSec: number;
  width: number;
  height: number;
}

/** Fades in over this many seconds, holds, then fades out over the same. */
const FADE_SEC = 0.6;

/** Opacity for the overlay at `sceneSec`. 0 outside the window, ramping
 *  at both edges so the text arrives and leaves instead of popping. */
export function overlayOpacity(
  sceneSec: number,
  startSec: number,
  endSec: number,
): number {
  if (sceneSec < startSec || sceneSec > endSec) return 0;
  const into = sceneSec - startSec;
  const out = endSec - sceneSec;
  // The shortest edge wins: a window shorter than two fades never reaches
  // full opacity, and at either edge the value is 0 — the text arrives
  // and leaves rather than popping.
  const fade = Math.min(into, out, FADE_SEC);
  if (fade <= 0) return 0;
  return Math.max(0, Math.min(1, fade / FADE_SEC));
}

/**
 * CS-06 — a text layer composited OVER the scene's own image.
 *
 * It is deliberately NOT a scene of its own: the film's title sits in the
 * opening shot's quiet area and fades out, and a chapter name appears
 * only where a section turn earns one. There is no separate title card
 * and no separate chapter card anywhere in this pipeline.
 *
 * The text uses the THEME's own sans-serif face — never a brush or
 * calligraphic face, which a storytelling channel would otherwise be
 * tempted by. No plate: legibility comes from a halo, the same treatment
 * the caption track uses.
 */
export const TextOverlay: FC<TextOverlayProps> = ({
  theme = darkTechTheme,
  title,
  chapter,
  position = "top",
  startSec,
  endSec,
  sceneSec,
  width,
  height,
}) => {
  const opacity = overlayOpacity(sceneSec, startSec, endSec);
  if (opacity <= 0) return null;
  if (title === undefined && chapter === undefined) return null;

  const titleSize = Math.round(height * 0.062);
  const chapterSize = Math.round(height * 0.036);
  const margin = Math.round(Math.min(width, height) * 0.06);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        [position === "top" ? "top" : "bottom"]: margin,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: Math.round(chapterSize * 0.6),
        pointerEvents: "none",
        opacity,
        zIndex: 35,
      }}
    >
      {title !== undefined ? (
        <span
          style={{
            color: theme.colors.primary,
            fontFamily: theme.typography.title.fontFamily,
            fontWeight: theme.typography.title.fontWeight,
            fontSize: titleSize,
            letterSpacing: Math.round(titleSize * 0.06),
            textShadow:
              "0 1px 0 rgba(0,0,0,0.55), 0 -1px 0 rgba(0,0,0,0.55), 1px 0 0 rgba(0,0,0,0.55), -1px 0 0 rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.35)",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
      ) : null}
      {chapter !== undefined ? (
        <span
          style={{
            color: theme.colors.secondary,
            fontFamily: theme.typography.body.fontFamily,
            fontWeight: theme.typography.body.fontWeight,
            fontSize: chapterSize,
            letterSpacing: Math.round(chapterSize * 0.12),
            textShadow:
              "0 1px 0 rgba(0,0,0,0.5), 0 -1px 0 rgba(0,0,0,0.5), 1px 0 0 rgba(0,0,0,0.5), -1px 0 0 rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.3)",
          }}
        >
          {chapter}
        </span>
      ) : null}
    </div>
  );
};