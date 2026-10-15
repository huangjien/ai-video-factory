/**
 * v0.6 — image-style presets for FLUX scene visuals (P0/P1).
 *
 * The image provider generates FULL-SCENE background art; the precise
 * geometry and all written text stay in Remotion components / SvgScene /
 * the Pillow textOverlay pass. A style preset therefore only shapes the
 * BACKGROUND's visual language, at two injection points:
 *
 *   1. `systemBlock` — extra rules for the LLM that rewrites the
 *      `visual:` line (expandScenePrompt), so the expansion BIAS is
 *      right (composition, palette discipline, metaphor use).
 *   2. `promptSuffix` — appended verbatim to the final prompt, so the
 *      image model sees the style contract even when the LLM drifts.
 *
 * Styles (engineering proposal 2026-10-15):
 *   flat-vector  — default. Clean geometry → composes with the vector
 *                  REGISTRY components; highest cross-scene consistency.
 *   editorial    — narrative/metaphor mode for history & abstract topics.
 *   whiteboard   — teaching mode. Marker line-art on white; pairs with
 *                  SvgScene draw-on animations. NOT the retired
 *                  DoodleScene canvas renderer.
 *
 * Cross-scene consistency comes from `--reference-style-anchor`
 * conditioning + these shared contracts, not from any single prompt.
 */

export const IMAGE_STYLES = [
  "flat-vector",
  "editorial",
  "whiteboard",
] as const;

export type ImageStyle = (typeof IMAGE_STYLES)[number];

export const DEFAULT_IMAGE_STYLE: ImageStyle = "flat-vector";

/** Unknown / missing / invalid → default (never throws). */
export function resolveImageStyle(value: unknown): ImageStyle {
  return (IMAGE_STYLES as readonly string[]).includes(value as string)
    ? (value as ImageStyle)
    : DEFAULT_IMAGE_STYLE;
}

interface StylePreset {
  /** Composition guidance for the prompt-expanding LLM. */
  systemBlock: string;
  /** Style contract appended to the final image prompt. */
  promptSuffix: string;
}

export const IMAGE_STYLE_PRESETS: Record<ImageStyle, StylePreset> = {
  "flat-vector": {
    systemBlock: `Style: FLAT VECTOR ILLUSTRATION.
- Compose from clean geometric shapes, solid fills, minimal detail.
- One restrained palette of 3-5 harmonious colors plus a light background; no gradients, no textures, no photorealism.
- Favor clear figure-ground separation so foreground shapes read instantly at 1080p and survive slow zoom/pan camera moves.
- Leave breathing room (lower third and edges) — UI captions and component overlays are added later.`,
    promptSuffix:
      "flat vector illustration, clean geometric shapes, solid fills, limited 4-color palette, light background, no gradients, no texture, minimalist composition, generous negative space, no text, no letters, no words",
  },
  editorial: {
    systemBlock: `Style: EDITORIAL ILLUSTRATION (narrative mode).
- Express the scene's IDEA through one visual metaphor — a single strong conceit, not a literal scene dump.
- Stylized human figures with simplified faces and consistent proportions; when people appear, keep the same figure design language as the rest of the video.
- A muted, editorial palette (2 main colors + 1 accent) on a calm background; subtle paper-like texture allowed.
- Mood carries the argument: serious topics read contemplative, not cartoonish.`,
    promptSuffix:
      "editorial illustration, single visual metaphor, stylized simplified figures, muted palette with one accent color, subtle paper texture, calm sophisticated mood, storybook composition, no text, no letters, no handwriting",
  },
  whiteboard: {
    systemBlock: `Style: WHITEBOARD / HAND-DRAWN MARKER SKETCH (teaching mode).
- Black ink line-art with ONE accent color for emphasis, on a clean white board.
- Doodle-level simplification: arrows, boxes, simple stick-ish figures, circled highlights.
- Generous white space; linework slightly imperfect like a real marker (no photorealism, no shading gradients).
- This is a BACKGROUND for draw-on animations: keep elements sparse and spatially separated so animated overlays have room.`,
    promptSuffix:
      "whiteboard marker sketch, hand-drawn black ink line art with one blue accent, doodle arrows and boxes, clean white background, imperfect linework, large white space, no shading, no text, no labels, no letters",
  },
};

/** Extra system rules for expandScenePrompt — always injected, so the
 * style contract is explicit even at the default and cache entries are
 * style-tagged. */
export function styleSystemBlock(style: ImageStyle): string {
  return IMAGE_STYLE_PRESETS[style].systemBlock;
}

/** Appended verbatim to the expanded prompt before caching/writing. */
export function stylePromptSuffix(style: ImageStyle): string {
  return IMAGE_STYLE_PRESETS[style].promptSuffix;
}
