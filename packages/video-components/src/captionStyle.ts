import type { CSSProperties } from "react";
import type { Theme } from "./theme.js";

/**
 * Shared caption styling. Two components draw a caption — the
 * `CaptionsOverlay` track and `ImageBackground`'s own convenience caption —
 * and they must not disagree, or one scene shows two different-looking lines
 * of text in the same band.
 *
 * Captions own no background. They sit on a generated image that changes
 * every re-render, so a plate would only ever be legible against one
 * particular picture. Legibility comes from the glyphs instead: a tight
 * outline on all four sides plus a soft spread, in whichever direction the
 * theme's text colour needs.
 */

/** Caption type as a fraction of frame height. 0.032 ≈ 35px at 1080p. */
export const CAPTION_FONT_RATIO = 0.032;

/**
 * Is this colour light enough to need a dark outline?
 * Rec. 601 luma on the 8-bit channels, matching how the eye weights them.
 * Unparseable colours fall back to "light": 7 of the 9 registered themes
 * are light-ink, and a dark halo on light text is invisible while a light
 * halo on dark text is merely unneeded.
 */
export function isLightInk(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return true;
  const n = parseInt(m[1], 16);
  const luma =
    0.299 * ((n >> 16) & 0xff) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff);
  return luma >= 140;
}

/**
 * Four-way outline plus a soft drop and a wider glow. The outline keeps the
 * letter edge separated from any pixel value underneath; the glow keeps a
 * whole caption readable when it crosses a busy part of the image.
 *
 * Outline is done with `text-shadow` rather than `-webkit-text-stroke` on
 * purpose: a stroke is painted centred on the glyph edge, so it eats into
 * the letterform. CJK horizontals are barely 2px wide at 35px, and a 1px
 * stroke thins them by a third — the caption renders hollow.
 */
export function captionHalo(ink: string): string {
  const light = isLightInk(ink);
  const edge = light ? "rgba(0,0,0,0.92)" : "rgba(255,255,255,0.92)";
  const soft = light ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.55)";
  return [
    `0 1px 0 ${edge}`,
    `0 -1px 0 ${edge}`,
    `1px 0 0 ${edge}`,
    `-1px 0 0 ${edge}`,
    `0 2px 5px ${soft}`,
    `0 0 14px ${soft}`,
  ].join(", ");
}

/** Distance from the bottom edge, as a fraction of frame height. */
export const CAPTION_BOTTOM_RATIO = 0.055;

/** Widest a single caption line may run, as a fraction of frame width. */
export const CAPTION_MAX_WIDTH_RATIO = 0.86;

/** The bottom caption band's container geometry, as ratios of the frame —
 * the single source for both caption draw paths (the `CaptionsOverlay`
 * track and `ImageBackground`'s convenience caption), so the two can never
 * drift into different bands on the same frame. */
export function captionContainerStyle(height: number): CSSProperties {
  return {
    position: "absolute" as const,
    left: 0,
    right: 0,
    bottom: Math.round(height * CAPTION_BOTTOM_RATIO),
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: Math.round(captionFontSize(height) * 0.3),
    pointerEvents: "none",
  };
}

/** Per-line box: max-width as a fraction of frame width, padding inset
 * only so the outline has room to render (there is no plate). */
export function captionLineStyle(
  width: number,
  height: number,
): CSSProperties {
  const fontSize = captionFontSize(height);
  return {
    maxWidth: Math.round(width * CAPTION_MAX_WIDTH_RATIO),
    padding: `${Math.round(fontSize * 0.1)}px ${Math.round(fontSize * 0.25)}px`,
    textAlign: "center" as const,
  };
}

/** Caption type in px for a given frame height. */
export function captionFontSize(height: number): number {
  return Math.round(height * CAPTION_FONT_RATIO);
}

/** The full text style a caption needs, whatever draws it. */
export function captionTextStyle(theme: Theme, fontSize: number) {
  const ink = theme.colors.primary;
  return {
    color: ink,
    fontFamily: theme.typography.body.fontFamily,
    fontWeight: theme.typography.body.fontWeight,
    fontSize,
    lineHeight: 1.35,
    textShadow: captionHalo(ink),
  };
}
