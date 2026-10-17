/**
 * v0.6 — image-style presets for generated scene visuals (P0/P1).
 *
 * The image provider generates FULL-SCENE background art; the precise
 * geometry and all written text stay in Remotion components / SvgScene.
 * Image models garble written text (especially CJK), so prompts must stay
 * text-free. A style preset therefore only shapes the BACKGROUND's
 * visual language, at two injection points:
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
 * Cross-scene consistency comes from these shared contracts — reusing
 * the same palette and camera vocabulary across scenes — not from any
 * single prompt.
 */
import { loadImageStylePresets, loadPrompt } from "@video/prompts";

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

export const IMAGE_STYLE_PRESETS: Record<ImageStyle, StylePreset> =
  loadImageStylePresets() as Record<ImageStyle, StylePreset>;

/**
 * Hard rule injected into every prompt expansion, on top of each
 * preset's own suffix. Image models cannot render legible writing —
 * they emit confident-looking gibberish, and CJK comes out worse than
 * Latin. Observed failure: `editorial` + a hosted image model produced
 * full two-page spreads of fake paragraphs for three scenes in a row,
 * regardless of a "no text" suffix on the prompt.
 *
 * So the rule is aimed at the LLM doing the expansion, not only at the
 * final prompt string: it must never ASK for text in the first place.
 * When a scene genuinely needs printed material, describe it as blank or
 * illegible — vague marks, never words.
 */
/** Body lives in `packages/prompts/prompts/image-no-text-rules.md` — edit it there. */
const NO_TEXT_RULES = loadPrompt("image-no-text-rules");

/** Extra system rules for expandScenePrompt — always injected, so the
 * style contract is explicit even at the default and cache entries are
 * style-tagged. */
export function styleSystemBlock(style: ImageStyle): string {
  return `${IMAGE_STYLE_PRESETS[style].systemBlock}\n\n${NO_TEXT_RULES}`;
}

/** Appended verbatim to the expanded prompt before caching/writing. */
export function stylePromptSuffix(style: ImageStyle): string {
  return IMAGE_STYLE_PRESETS[style].promptSuffix;
}
