/**
 * Shared helper for reading `scene.animations[]` into per-element timing.
 * Mirrors `svgSceneLogic.resolveElementTiming` but is intentionally
 * simpler — non-SvgScene components only need a flat target → {start,
 * duration, easing, type} lookup so they can replace their baked-in
 * animations with the same contract.
 */

export interface TimelineAnim {
  id: string;
  target: string;
  type: string;
  start: number;
  duration: number;
  easing: string;
}

export interface ElementTiming {
  start: number; // seconds from scene start
  duration: number; // seconds
  type: string;
}

/** First-wins lookup: returns a target's animation timing, or null. */
export function lookupTiming(
  animations: TimelineAnim[] | undefined,
  target: string,
): ElementTiming | null {
  if (!animations) return null;
  for (const a of animations) {
    if (a.target === target) {
      return { start: a.start, duration: a.duration, type: a.type };
    }
  }
  return null;
}

/** Convenience: returns progress 0..1 for `target` at scene-relative
 *  second `t`. Easing maps to a simple easeOut curve — fine for the
 *  visual differences we currently produce. */
export function progressFor(
  animations: TimelineAnim[] | undefined,
  target: string,
  sceneSecond: number,
  defaultDurationSec = 0.5,
): number {
  const timing = lookupTiming(animations, target);
  const start = timing?.start ?? 0;
  const duration = timing?.duration ?? defaultDurationSec;
  if (duration <= 0) return 1;
  const t = (sceneSecond - start) / duration;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return easeOut(t);
}

/** Generic tween used by non-SvgScene components. Sub-classes may
 *  override (e.g. the SvgScene component uses its own per-element
 *  timing math). */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}