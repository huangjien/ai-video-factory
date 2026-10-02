/**
 * Pure logic for SvgScene (plan T4.3 — whiteboard/diagram scenes):
 * easing solver + timeline resolution. No React here so everything is
 * unit-testable; the component consumes these.
 *
 * Provenance: the draw-on mechanic follows the whiteboard-animation skill
 * (.agents/skills/whiteboard-animation/SKILL.md — "SVG stroke draw-on",
 * staggered reveal in narration order); timing defaults come from the
 * animation-principles skill (entrances 0.3–0.8s, ease-out).
 */

export type VdslEasing = "linear" | "easeIn" | "easeOut" | "easeInOut";

/** CSS-style cubic easing for the four VDSL canonical curves.
 * easeInOut is the standard symmetric cubic; easeIn/easeOut are its halves
 * (t³ / 1-(1-t)³) — monotonic, endpoints pinned. */
export function easeAtProgress(easing: VdslEasing, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (easing) {
    case "linear":
      return x;
    case "easeIn":
      return x * x * x;
    case "easeOut":
      return 1 - Math.pow(1 - x, 3);
    case "easeInOut":
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
}

export interface TimelineAnim {
  id: string;
  target: string;
  type: string;
  start: number;
  duration: number;
  easing: string;
}

export interface ElementTiming {
  /** Seconds (scene-relative) when the element starts appearing. */
  start: number;
  duration: number;
  easing: VdslEasing;
  type: "draw" | "write" | "fade" | "highlight" | "other";
}

export interface SceneElementRef {
  id: string;
  kind: "node" | "edge";
  order: number;
}

/** Resolve the per-element timing for a scene: explicit `animations[]`
 * targeting element ids win; elements without one get the whiteboard
 * default — sequential draw-on (nodes first, then edges) with ease-out,
 * 0.7s each, staggered ~0.25s (skill: reveal in narration order). */
export function resolveElementTiming(
  animations: TimelineAnim[],
  elements: SceneElementRef[],
  sceneDurationSec: number,
  fps: number,
): Map<string, ElementTiming> {
  const out = new Map<string, ElementTiming>();
  const explicit = new Map<string, TimelineAnim>();
  for (const anim of animations) {
    // First animation per target wins (deterministic).
    if (!explicit.has(anim.target)) explicit.set(anim.target, anim);
  }

  const ordered = [...elements].sort((a, b) =>
    a.kind === b.kind ? a.order - b.order : a.kind === "node" ? -1 : 1,
  );
  const defaultStagger = 0.25;
  const defaultDuration = Math.min(0.7, Math.max(0.35, sceneDurationSec * 0.2));

  ordered.forEach((el, i) => {
    const anim = explicit.get(el.id);
    if (anim) {
      out.set(el.id, {
        start: anim.start,
        duration: anim.duration,
        easing: (EASINGS as readonly string[]).includes(anim.easing)
          ? (anim.easing as VdslEasing)
          : "easeOut",
        type: normalizeType(anim.type),
      });
      return;
    }
    const start = Math.min(
      i * defaultStagger,
      Math.max(0, sceneDurationSec - defaultDuration),
    );
    out.set(el.id, {
      start,
      duration: defaultDuration,
      easing: "easeOut",
      type: el.kind === "edge" ? "draw" : "draw",
    });
  });
  void fps;
  return out;
}

const EASINGS = ["linear", "easeIn", "easeOut", "easeInOut"];

function normalizeType(t: string): ElementTiming["type"] {
  if (t === "draw" || t === "write" || t === "fade" || t === "highlight") {
    return t;
  }
  return "other";
}

/** Progress (0..1, eased) of an element at a given frame. */
export function elementProgress(
  timing: ElementTiming,
  frame: number,
  fps: number,
): number {
  const sec = frame / fps;
  const t = (sec - timing.start) / timing.duration;
  return easeAtProgress(timing.easing, t);
}
