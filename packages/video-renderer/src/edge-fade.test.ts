import { describe, expect, it } from "vitest";
import { EDGE_FADE_SEC, edgeFadeOpacity } from "./Root.js";

/** The film's head and tail fade through black. Without it, the opening
 *  is a bare lit canvas with the voice already talking over it — the
 *  eye has nothing to land on. */
describe("edgeFadeOpacity — the film's head and tail", () => {
  const FADE = 24; // 0.8s at 30fps

  it("starts the first scene fully black and lifts to clear", () => {
    // (absoluteStart, absoluteEnd, localFrame, duration, filmTotal, fade)
    expect(edgeFadeOpacity(0, 300, 0, 300, 1200, FADE)).toBe(1);
    expect(edgeFadeOpacity(0, 300, 1, 300, 1200, FADE)).toBeLessThan(1);
    expect(edgeFadeOpacity(0, 300, FADE, 300, 1200, FADE)).toBe(0);
    expect(edgeFadeOpacity(0, 300, 200, 300, 1200, FADE)).toBe(0);
  });

  it("does not fade a middle scene (the film's edges only)", () => {
    // A scene in the middle: absolute start > 0, absolute end < film end.
    expect(edgeFadeOpacity(300, 600, 0, 300, 1200, FADE)).toBe(0);
    expect(edgeFadeOpacity(300, 600, 299, 300, 1200, FADE)).toBe(0);
  });

  it("ends the last scene fully black", () => {
    // The last scene: absolute end == the film's total frames.
    const duration = 300;
    const filmTotal = 1200;
    const start = filmTotal - duration;
    expect(
      edgeFadeOpacity(
        start,
        filmTotal,
        duration - 1,
        duration,
        filmTotal,
        FADE,
      ),
    ).toBe(1);
    expect(
      edgeFadeOpacity(
        start,
        filmTotal,
        duration - 2,
        duration,
        filmTotal,
        FADE,
      ),
    ).toBeLessThan(1);
    expect(
      edgeFadeOpacity(
        start,
        filmTotal,
        duration - FADE - 1,
        duration,
        filmTotal,
        FADE,
      ),
    ).toBe(0);
    expect(
      edgeFadeOpacity(start, filmTotal, 10, duration, filmTotal, FADE),
    ).toBe(0);
  });

  it("leaves middle scenes alone", () => {
    // Four scenes of 300 frames: 0-300, 300-600, 600-900, 900-1200.
    // Only the last one reaches the film's end.
    for (const idx of [1, 2]) {
      const start = idx * 300;
      expect(edgeFadeOpacity(start, start + 300, 0, 300, 1200, FADE)).toBe(0);
      expect(edgeFadeOpacity(start, start + 300, 299, 300, 1200, FADE)).toBe(0);
    }
  });

  it("never exceeds the 0..1 range", () => {
    for (const frame of [0, 1, 23, 24, 25, 298, 299]) {
      for (const idx of [0, 4]) {
        const v = edgeFadeOpacity(
          idx * 300,
          idx * 300 + 300,
          frame,
          300,
          1500,
          FADE,
        );
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is a no-op when the fade is disabled", () => {
    expect(edgeFadeOpacity(0, 300, 0, 300, 300, 0)).toBe(0);
  });

  it("runs for a fraction of a second", () => {
    expect(EDGE_FADE_SEC).toBeGreaterThan(0);
    expect(EDGE_FADE_SEC).toBeLessThanOrEqual(1.5);
  });
});
