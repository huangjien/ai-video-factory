/**
 * v0.4.1 — Animation emitter for `scene.animations[]`.
 *
 * Given a component name and the props the visual builder produced,
 * emit a list of timeline animations (`{id, target, type, start, duration, easing}`)
 * that drives per-element choreography inside the scene. The shape
 * matches `vdsl.timelineAnimationSchema` (`packages/vdsl/src/schema.ts:413-431`).
 *
 * Today only `DoodleScene` reads these, but the schema is component-agnostic,
 * so the same emitted list is the contract the renderers honour.
 *
 * Strategy
 *   - **Stagger** elements across the scene's duration with a small gap.

 *   - **Highlight** for emphasis rows and milestone events.

 *
 * Deterministic (no LLM), idempotent, free. Runs at YAML-build time.
 */

export interface TimelineAnimation {
  id: string;
  target: string;
  type: "draw" | "write" | "fade" | "move" | "scale" | "rotate" | "highlight";
  /** Scene-relative seconds. */
  start: number;
  duration: number;
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut";
}

export interface EmitContext {
  /** Scene duration in seconds — animation timing must fit within this. */
  sceneDurationSec: number;
}

const EASING: TimelineAnimation["easing"] = "easeOut";

/** Public dispatch: (component, props, ctx) → TimelineAnimation[] */
export function emitSceneAnimations(
  component: string,
  props: Record<string, unknown>,
  ctx: EmitContext,
): TimelineAnimation[] {
  switch (component) {
    case "Title":
      return emitTitleAnimations(props, ctx);
    default:
      return [];
  }
}

function emitTitleAnimations(
  _props: Record<string, unknown>,
  ctx: EmitContext,
): TimelineAnimation[] {
  return [
    {
      id: "title-entrance",
      target: "__title__",
      type: "highlight",
      start: 0,
      duration: round2(Math.min(ctx.sceneDurationSec, 1.0)),
      easing: EASING,
    },
  ];
}

// ---------------------------------------------------------------------------
// QuoteBlock — card highlight, then the attribution fades in.
// ---------------------------------------------------------------------------

function budget(
  sceneDurationSec: number,
  elementCount: number,
): {
  perElementSec: number;
  totalBudget: number;
} {
  const totalBudget = Math.max(1.5, sceneDurationSec * 0.85);
  const perElementSec = Math.max(
    0.18,
    Math.min(1.0, totalBudget / Math.max(1, elementCount)),
  );
  return { perElementSec, totalBudget };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cap an animation so start + duration never exceeds the scene —
 * stagger multipliers (per × 1.2) otherwise overshoot short scenes and
 * validation hard-fails the draft. */
function fitWithin(
  durationSec: number,
  startSec: number,
  sceneDurationSec: number,
): number {
  return round2(
    Math.max(0.05, Math.min(durationSec, sceneDurationSec - startSec)),
  );
}

/** Narrow `value` to a record that has `prop` as a string. The return
 *  type carries the property name through, so callers get full type
 *  safety on subsequent access. */
function isObjectWithStringProp<K extends string>(
  value: unknown,
  prop: K,
): value is Record<K, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    prop in value &&
    typeof (value as Record<string, unknown>)[prop] === "string"
  );
}
