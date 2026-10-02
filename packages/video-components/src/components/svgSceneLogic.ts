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
    // Camera animations drive the VIEW, not element appearance — they
    // must not hijack the element's draw timing.
    if (anim.type === "camera") continue;
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

export interface CameraTransform {
  scale: number;
  tx: number;
  ty: number;
}

interface CameraRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Target-driven camera (plan T7.4/§35 "Camera"): a `type: "camera"`
 * animation targeting a node pans/zooms the view so that node fills the
 * frame (~60% of the shorter axis). The transform eases in over the
 * animation window and holds until the next camera. No schema change —
 * the node rect IS the camera parameter. */
export function resolveCameraTransform(
  animations: TimelineAnim[],
  nodes: CameraRect[],
  frame: number,
  fps: number,
  canvasW = 1920,
  canvasH = 1080,
): CameraTransform {
  const identity: CameraTransform = { scale: 1, tx: 0, ty: 0 };
  const cameras = animations
    .filter((a) => a.type === "camera")
    .sort((a, b) => a.start - b.start);
  const sec = frame / fps;
  const active = [...cameras].reverse().find((c) => sec >= c.start);
  if (!active) return identity;
  const focus = nodes.find((n) => n.id === active.target);
  if (!focus || focus.w <= 0 || focus.h <= 0) return identity;

  const targetScale = Math.min(
    2.5,
    Math.min(canvasW / (focus.w * 1.6), canvasH / (focus.h * 1.6)),
  );
  const cx = focus.x + focus.w / 2;
  const cy = focus.y + focus.h / 2;
  const target: CameraTransform = {
    scale: targetScale,
    tx: canvasW / 2 - cx * targetScale,
    ty: canvasH / 2 - cy * targetScale,
  };

  const easing = (EASINGS as readonly string[]).includes(active.easing)
    ? (active.easing as VdslEasing)
    : "easeInOut";
  const p = easeAtProgress(easing, (sec - active.start) / active.duration);
  const eased = Math.min(1, Math.max(0, p));
  // Ease from the PREVIOUS camera's end state (or identity) to this one,
  // then hold — deterministic and cut-safe.
  const prevCam = [...cameras]
    .reverse()
    .find((c) => c.start < active.start && nodes.some((n) => n.id === c.target));
  const from = prevCam
    ? cameraTransformAt(cameras, nodes, Math.max(0, (active.start - 0.001) * fps), fps, canvasW, canvasH)
    : identity;
  return {
    scale: from.scale + (target.scale - from.scale) * eased,
    tx: from.tx + (target.tx - from.tx) * eased,
    ty: from.ty + (target.ty - from.ty) * eased,
  };
}

function cameraTransformAt(
  animations: TimelineAnim[],
  nodes: CameraRect[],
  frame: number,
  fps: number,
  canvasW: number,
  canvasH: number,
): CameraTransform {
  return resolveCameraTransform(animations, nodes, frame, fps, canvasW, canvasH);
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
