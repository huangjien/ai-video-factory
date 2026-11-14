import type { Theme } from "./theme.js";

/**
 * The title card's pure layout and ink rules.
 *
 * Kept out of the component so they can be reasoned about (and tested)
 * without a browser: the ink depends on the ART's brightness, which is
 * measured at render time, and the type size depends on how wide the
 * title is.
 */

/**
 * Luma above which the art reads as paper and takes DARK ink. Below it
 * the art is a scene, and light ink reads on it. Both approved
 * treatments land on the right side of the line: the ink-on-paper card
 * measures 214 in the band its type covers, the brush column measures
 * 156 in the strip its column covers.
 */
export const TITLE_PAPER_LUMA = 190;

/** Rec. 601 luma of a `#RRGGBB` colour, 0–255. */
export function luma(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return 0;
  const n = parseInt(m[1], 16);
  return (
    0.299 * ((n >> 16) & 0xff) +
    0.587 * ((n >> 8) & 0xff) +
    0.114 * (n & 0xff)
  );
}

/**
 * The ink the title is drawn in.
 *
 * The card's type sits on a generated picture whose brightness is
 * unknown until the picture exists, so the ink is chosen against the
 * ART, not against the theme. Both inks come from the theme — its text
 * colour and its surface colour — so the card never introduces a
 * colour the palette does not already own. Without art there is
 * nothing to adapt to, and the theme's own text colour is used.
 */
export function titleInk(theme: Theme, artLuma: number | null): string {
  const primary = theme.colors.primary;
  const surface = theme.colors.background;
  const dark = luma(primary) <= luma(surface) ? primary : surface;
  const light = dark === primary ? surface : primary;
  if (artLuma === null) return primary;
  return artLuma >= TITLE_PAPER_LUMA ? dark : light;
}

/** Is this colour light enough to need a dark outline? */
export function isLightInk(hex: string): boolean {
  return luma(hex) >= 140;
}

/** Full-width (CJK / kana) glyphs take a whole em; Latin about half. */
export function isWideGlyph(ch: string): boolean {
  return /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFF60]/u.test(ch);
}

/** How wide the title is, in ems. */
export function titleWidthUnits(chars: string[]): number {
  return chars.reduce((sum, ch) => sum + (isWideGlyph(ch) ? 1 : 0.55), 0);
}

/**
 * Does this title want a vertical column? A brush column only reads for
 * CJK — Latin set vertically is unreadable.
 */
export function wantsVerticalTitle(text: string): boolean {
  return /[\u3040-\u30FF\u3400-\u9FFF]/u.test(text);
}

/**
 * The type size that fits the title in its band. The card never wraps a
 * headline onto a second line: a long title is set smaller instead.
 */
export function titleFontSize(
  chars: string[],
  width: number,
  height: number,
  vertical: boolean,
): number {
  const units = Math.max(1, titleWidthUnits(chars));
  return vertical
    ? Math.max(48, Math.min(132, Math.floor(((height - 220) / units) * 0.94)))
    : Math.max(
        40,
        Math.min(96, Math.floor(((width * 0.72) / units) * 0.95)),
      );
}
