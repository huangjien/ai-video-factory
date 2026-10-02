/**
 * Built-in motion heuristics (plan T4.1, AD-5 fallback layer).
 *
 * PROVENANCE: every number below is transcribed from the
 * `animation-principles` skill (.agents/skills/animation-principles/SKILL.md,
 * iart-ai/motion-design-skills). The skill is prose guidance; these tables
 * are its machine-usable core, so the pipeline behaves identically when the
 * skills directory is absent. If the skill is upgraded, re-derive these
 * numbers from it.
 *
 * Easing values are VDSL canonical (linear|easeIn|easeOut|easeInOut).
 * The skill's overshoot/bezier curves (e.g. cubic-bezier(0.34, 1.56, ...))
 * have no VDSL equivalent yet — plan §10 defers spring/overshoot types.
 */

export interface EasingRule {
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut";
  /** [fastest, slowest] recommended duration in seconds. */
  durationSec: readonly [number, number];
}

/** Quick reference table (SKILL.md "Quick reference" + timing table):
 * enter = ease-out 300–500ms (hero/full-screen up to 800ms);
 * exit = ease-in 200–300ms; move = ease-in-out 300–400ms. */
export const EASING_RULES = {
  enter: { easing: "easeOut", durationSec: [0.3, 0.8] },
  exit: { easing: "easeIn", durationSec: [0.2, 0.3] },
  move: { easing: "easeInOut", durationSec: [0.3, 0.4] },
} as const satisfies Record<string, EasingRule>;

/** Lists/grid stagger (SKILL.md "Spacing and stagger"): 40–80ms per item,
 * total reveal capped ~600–800ms. */
export const STAGGER = {
  perItemSec: [0.04, 0.08] as const,
  defaultSec: 0.06,
  capSpreadSec: 0.7,
};

/** Entrance animations start slightly after the scene opens (let the
 * transition breathe). */
export const ENTRANCE_DELAY_SEC = 0.1;

/** An entrance should not eat the scene: cap at ~35% of scene duration
 * (SKILL.md: "feels floaty → duration too long → cut 30%"). */
export const ENTRANCE_MAX_SCENE_FRACTION = 0.35;

/** Scenes long enough to earn one mid-scene emphasis beat (SKILL.md rhythm:
 * one major event per ~500–800ms is for montages; for explainer scenes a
 * single highlight around the halfway point keeps a focal point). */
export const EMPHASIS_MIN_SCENE_SEC = 6;
export const EMPHASIS_AT_FRACTION = 0.5;
export const EMPHASIS_DURATION_SEC = 0.6;

/** Component family → entrance animation type (VDSL canonical). Elements
 * that read as diagrams draw on; text terminals type on; everything else
 * fades. */
export const COMPONENT_ENTRANCE: ReadonlyArray<{
  match: RegExp;
  type: "draw" | "write" | "fade" | "scale";
}> = [
  { match: /^(FlowChart|Timeline|Comparison|ImageBackground|Image)$/, type: "draw" },
  { match: /^(CodeBlock|Terminal)$/, type: "write" },
  { match: /^(Character|EndCard)$/, type: "scale" },
];

export function entranceTypeForComponent(component: string): "draw" | "write" | "fade" | "scale" {
  for (const rule of COMPONENT_ENTRANCE) {
    if (rule.match.test(component)) return rule.type;
  }
  return "fade";
}

/** Quantize a time onto a musical beat grid (SKILL.md "Beat-sync": land
 * impacts ON the beat; 120 BPM → 500ms grid). Returns the input unchanged
 * when bpm is undefined. */
export function quantizeToBeat(sec: number, bpm?: number): number {
  if (!bpm || bpm <= 0) return sec;
  const beat = 60 / bpm;
  return Math.round(sec / beat) * beat;
}

export function clampDuration(sec: number, sceneDurationSec: number): number {
  const [min, max] = EASING_RULES.enter.durationSec;
  const byScene = sceneDurationSec * ENTRANCE_MAX_SCENE_FRACTION;
  return Math.min(max, Math.max(min, Math.min(byScene, sec)));
}
