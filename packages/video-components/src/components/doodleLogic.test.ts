import { describe, expect, it } from "vitest";
import {
  buildStrokePlan,
  drawDoodleFrame,
  hashStr,
  rng,
  shapeStrokes,
  wobblePoints,
  type CtxLike,
} from "./doodleLogic.js";

describe("doodleLogic — deterministic hand-drawn strokes (T4.4)", () => {
  it("rng is deterministic and hashStr is stable", () => {
    const a = rng(42);
    const b = rng(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(hashStr("ink")).toBe(hashStr("ink"));
    expect(hashStr("ink")).not.toBe(hashStr("marker"));
  });

  it("wobble is seeded — same seed, identical points; different seed, different points", () => {
    const pts: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    expect(wobblePoints(pts, 7, 3)).toEqual(wobblePoints(pts, 7, 3));
    expect(wobblePoints(pts, 7, 3)).not.toEqual(wobblePoints(pts, 8, 3));
    // wobble disabled → identical
    expect(wobblePoints(pts, 7, 0)).toEqual(pts);
  });

  it("shape generators produce on-canvas stroke points", () => {
    for (const kind of ["circle", "star", "zigzag", "spiral"] as const) {
      const pts = shapeStrokes(kind, 500, 300, 120, 1);
      expect(pts.length).toBeGreaterThanOrEqual(5);
      for (const [x, y] of pts) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      }
    }
  });

  it("buildStrokePlan sequences strokes over ~70% of the scene", () => {
    const plan = buildStrokePlan(
      [
        { id: "a", shape: "circle", x: 300, y: 300, size: 120 },
        { id: "b", shape: "star", x: 900, y: 300, size: 140 },
        { id: "c", shape: "zigzag", x: 1400, y: 300, size: 100 },
      ],
      5,
      1,
      { background: "#fff", ink: "#000", wobble: 2 },
    );
    expect(plan).toHaveLength(3);
    expect(plan[0]!.startSec).toBe(0);
    expect(plan[2]!.startSec + plan[2]!.durationSec).toBeLessThanOrEqual(3.5);
    // multi-pass ink: two slightly different passes per stroke
    expect(plan[0]!.passes).toHaveLength(2);
    expect(plan[0]!.passes[0]).not.toEqual(plan[0]!.passes[1]);
    // deterministic across calls
    const again = buildStrokePlan(
      [
        { id: "a", shape: "circle", x: 300, y: 300, size: 120 },
        { id: "b", shape: "star", x: 900, y: 300, size: 140 },
        { id: "c", shape: "zigzag", x: 1400, y: 300, size: 100 },
      ],
      5,
      1,
      { background: "#fff", ink: "#000", wobble: 2 },
    );
    expect(again).toEqual(plan);
  });

  it("beat-sync: stroke onsets quantize to the BPM grid (plan §35 Demo 2)", () => {
    const strokes = [
      { id: "a", shape: "circle" as const, x: 300, y: 300, size: 120 },
      { id: "b", shape: "star" as const, x: 900, y: 300, size: 140 },
      { id: "c", shape: "zigzag" as const, x: 1400, y: 300, size: 100 },
      { id: "d", shape: "spiral" as const, x: 1600, y: 400, size: 90 },
    ];
    const plan = buildStrokePlan(strokes, 10, 5, { background: "#fff", ink: "#000", wobble: 2 }, { bpm: 100 });
    const beat = 60 / 100; // 0.6s
    for (const entry of plan) {
      const remainder = entry.startSec % beat;
      expect(Math.min(remainder, beat - remainder)).toBeLessThan(1e-9);
      expect(entry.startSec + entry.durationSec).toBeLessThanOrEqual(10);
    }
    // without bpm the raw sequential starts are NOT on the grid
    const raw = buildStrokePlan(strokes, 10, 5, { background: "#fff", ink: "#000", wobble: 2 });
    const offGrid = raw.some((e) => e.startSec % beat > 1e-9);
    expect(offGrid).toBe(true);
  });

  it("drawDoodleFrame draws progressively (pure function of the frame)", () => {
    const plan = buildStrokePlan(
      [
        { id: "a", shape: "spiral", x: 400, y: 300, size: 150 },
        { id: "b", shape: "circle", x: 1200, y: 300, size: 120 },
      ],
      6,
      3,
      { background: "#F5F1E8", ink: "#1F1D1A", wobble: 2 },
    );
    const record = (frame: number): number => {
      let segments = 0;
      const ctx: CtxLike = {
        clearRect() {},
        fillRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {
          segments += 1;
        },
        stroke() {},
        fillText() {},
        set fillStyle(_v: string) {},
        set strokeStyle(_v: string) {},
        set lineWidth(_v: number) {},
        set lineCap(_v: string) {},
        set lineJoin(_v: string) {},
        set globalAlpha(_v: number) {},
        set font(_v: string) {},
      };
      drawDoodleFrame(ctx, plan, frame, 30, { background: "#F5F1E8", ink: "#1F1D1A", wobble: 2 }, 1920, 1080);
      return segments;
    };
    const early = record(0);
    const mid = record(60); // 2s — first stroke mid-draw
    const late = record(210); // 7s — everything drawn
    expect(early).toBeLessThan(mid);
    expect(mid).toBeLessThan(late);
    // same frame → identical output (pure)
    expect(record(60)).toBe(mid);
  });
});
