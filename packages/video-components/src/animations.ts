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
