/**
 * The artistic faces the title card can set its type in.
 *
 * Both files are vendored in the workspace (`assets/fonts/`) and inlined
 * into the render plan as data URLs: the headless browser serves the
 * entry over HTTP and cannot read a local font file, exactly like the
 * scene images. The renderer resolves `file`; the component registers
 * `family` with the browser's font set.
 *
 * LXGW WenKai (SIL OFL) — a 楷 face that still reads as handwriting.
 * Ma Shan Zheng (SIL OFL) — a running brush, for vertical columns.
 */
export type TitleStyle = "kai" | "brush";

export interface TitleFont {
  /** CSS family name registered in the browser. */
  family: string;
  /** File name under the workspace's `assets/fonts/`. */
  file: string;
}

export const TITLE_FONTS: Record<TitleStyle, TitleFont> = {
  kai: { family: "TitleKai", file: "LXGWWenKai-Regular.ttf" },
  brush: { family: "TitleBrush", file: "MaShanZheng-Regular.ttf" },
};

export const TITLE_STYLES: TitleStyle[] = ["kai", "brush"];

/** Is this a title style the component knows how to draw? */
export function isTitleStyle(value: unknown): value is TitleStyle {
  return value === "kai" || value === "brush";
}
