/**
 * DoodleScene logic (plan T4.4 — canvas hand-drawn spike, §3.4).
 * Pure functions: stroke generation (procedural shapes with seeded wobble),
 * sequential draw timing, and the full per-frame canvas draw. The contract
 * follows the javascript-animation skill: "draw(frame) is a pure function
 * of the frame number; use rng(seed), never Math.random or Date."
 *
 * No DOM types here — drawFrame takes a minimal 2D-context-shaped recorder
 * so unit tests can assert the drawn geometry without a canvas.
 */

export interface CtxLike {
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  set fillStyle(v: string);
  set strokeStyle(v: string);
  set lineWidth(v: number);
  set lineCap(v: string);
  set lineJoin(v: string);
  set globalAlpha(v: number);
  set font(v: string);
}

/** Deterministic PRNG (mulberry32) — same seed, same wobble, every render. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type DoodleShape = "circle" | "star" | "zigzag" | "spiral";

/** Procedural stroke points for a shape, centered on (x, y). Circles are
 * two overlapping arcs (the hand-drawn "doesn't quite close" look). */
export function shapeStrokes(
  kind: DoodleShape,
  x: number,
  y: number,
  size: number,
  _seed: number,
): [number, number][] {
  if (kind === "circle") {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2 * 1.04; // overlap past close
      pts.push([x + Math.cos(a) * size, y + Math.sin(a) * size]);
    }
    return pts;
  }
  if (kind === "star") {
    const pts: [number, number][] = [];
    const spikes = 5;
    for (let i = 0; i <= spikes * 2; i++) {
      const r = i % 2 === 0 ? size : size * 0.45;
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    return pts;
  }
  if (kind === "zigzag") {
    const pts: [number, number][] = [];
    const w = size * 2;
    for (let i = 0; i <= 6; i++) {
      pts.push([x - w / 2 + (w * i) / 6, y + (i % 2 === 0 ? -size : size) * 0.5]);
    }
    return pts;
  }
  // spiral
  const pts: [number, number][] = [];
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * Math.PI * 4;
    const r = (i / 60) * size;
    pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  return pts;
}

/** Offset points with seeded, smooth-ish noise — the hand-drawn wobble.
 * Deterministic: same seed + points → identical output. */
export function wobblePoints(
  points: [number, number][],
  seed: number,
  amount: number,
): [number, number][] {
  if (amount <= 0) return points;
  const rand = rng(seed);
  const offsets = Array.from({ length: 4 }, () => (rand() - 0.5) * 2 * amount);
  return points.map(([px, py], i) => {
    const k = i % offsets.length;
    const l = (k + 1) % offsets.length;
    return [px + offsets[k]!, py + offsets[l]!] as [number, number];
  });
}

export interface DoodleStrokeSpec {
  id: string;
  /** Explicit pen path (canvas coordinates). */
  points?: [number, number][] | undefined;
  /** Or a procedural shape — mutually exclusive with points. */
  shape?: DoodleShape | undefined;
  x?: number | undefined;
  y?: number | undefined;
  size?: number | undefined;
  color?: string | undefined;
  width?: number | undefined;
  /** Multi-pass ink (default 2) — slightly offset redraws read as ink. */
  passes?: number | undefined;
}

export interface StrokePlanEntry {
  spec: DoodleStrokeSpec;
  passes: [number, number][][];
  startSec: number;
  durationSec: number;
}

export interface DoodleStyle {
  background: string;
  ink: string;
  wobble: number;
}

/** Sequential draw plan: strokes share ~70% of the scene (the tail stays
 * on screen), each stroke eased-in is handled at draw time. */
export function buildStrokePlan(
  strokes: DoodleStrokeSpec[],
  durationSec: number,
  seed: number,
  style: DoodleStyle,
): StrokePlanEntry[] {
  const total = Math.max(0.5, durationSec * 0.7);
  const each = total / Math.max(1, strokes.length);
  return strokes.map((spec, i) => {
    const strokeSeed = (seed ^ hashStr(spec.id)) >>> 0;
    const base =
      spec.points ??
      shapeStrokes(spec.shape ?? "circle", spec.x ?? 0, spec.y ?? 0, spec.size ?? 100, strokeSeed);
    const passes = Math.max(1, spec.passes ?? 2);
    const passPoints: [number, number][][] = Array.from(
      { length: passes },
      (_, p) =>
        wobblePoints(
          base,
          (strokeSeed + p * 7919) >>> 0,
          style.wobble * (p === 0 ? 1 : 0.6),
        ),
    );
    return {
      spec,
      passes: passPoints,
      startSec: i * each,
      durationSec: each,
    };
  });
}

/** Draw one frame: everything fully drawn up to now + the partial tip of
 * the current stroke. Pure in ctx output — same frame, same calls. */
export function drawDoodleFrame(
  ctx: CtxLike,
  plan: StrokePlanEntry[],
  frame: number,
  fps: number,
  style: DoodleStyle,
  width: number,
  height: number,
): void {
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, width, height);
  const sec = frame / fps;

  for (const entry of plan) {
    const t = (sec - entry.startSec) / entry.durationSec;
    if (t <= 0) continue;
    const progress = Math.min(1, t);
    const ink = entry.spec.color ?? style.ink;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = entry.spec.width ?? 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    entry.passes.forEach((pass, pi) => {
      ctx.globalAlpha = pi === 0 ? 0.95 : 0.45;
      const count = Math.max(
        2,
        Math.ceil(pass.length * progress),
      );
      ctx.beginPath();
      ctx.moveTo(pass[0]![0]!, pass[0]![1]!);
      for (let i = 1; i < count; i++) {
        ctx.lineTo(pass[i]![0]!, pass[i]![1]!);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }
}
