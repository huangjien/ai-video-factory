/**
 * Entrance animation primitives (doc §24).
 * Pure math helpers (frame -> interpolated value) so they are testable
 * without React. The renderer applies them via CSS style props in todos 8-10.
 */

export function fade(frame: number, durationFrames = 20): number {
  if (durationFrames <= 0) return 1;
  return Math.min(1, Math.max(0, frame / durationFrames));
}

export interface SlideResult {
  translate: number;
}

export function slide(
  frame: number,
  direction: "left" | "right" | "up" | "down" = "left",
  distance = 80,
  durationFrames = 20,
): SlideResult {
  const t = fade(frame, durationFrames);
  const remaining = distance * (1 - t);
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const translate = remaining === 0 ? 0 : sign * remaining;
  return { translate };
}

export function scale(frame: number, from = 0.92, durationFrames = 20): number {
  const t = fade(frame, durationFrames);
  return from + (1 - from) * t;
}

export function draw(frame: number, durationFrames = 30): number {
  return fade(frame, durationFrames);
}

export function typewriter(
  frame: number,
  text: string,
  charsPerFrame = 1.5,
): string {
  const visible = Math.floor(frame * charsPerFrame);
  return text.slice(0, visible);
}

/**
 * Composite entrance used by Title and (optionally) other headers.
 * Combines fade-in, slide-in, and scale-up so each text block arrives
 * with motion rather than just appearing.
 */
export function entrance(
  frame: number,
  durationFrames = 24,
  direction: "left" | "right" | "up" | "down" = "up",
): { opacity: number; translate: number; scale: number } {
  const t = fade(frame, durationFrames);
  const remaining = 40 * (1 - t);
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const translate = remaining === 0 ? 0 : sign * remaining;
  const s = 0.92 + (1 - 0.92) * t;
  return { opacity: t, translate, scale: s };
}

/**
 * Hold-then-exit: full opacity for the body of the scene, then fade
 * out in the last `exitFrames` frames. Used for scene-to-scene
 * transitions.
 */
export function fadeOut(
  frame: number,
  totalFrames: number,
  exitFrames = 15,
): number {
  const start = totalFrames - exitFrames;
  if (frame < start) return 1;
  return Math.max(0, 1 - (frame - start) / exitFrames);
}
