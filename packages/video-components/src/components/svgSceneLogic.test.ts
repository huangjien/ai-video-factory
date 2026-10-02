import { describe, expect, it } from "vitest";
import {
  easeAtProgress,
  elementProgress,
  resolveElementTiming,
  type SceneElementRef,
} from "./svgSceneLogic.js";

describe("easeAtProgress — VDSL canonical easings", () => {
  it("pins endpoints and stays monotonic for every curve", () => {
    for (const easing of ["linear", "easeIn", "easeOut", "easeInOut"] as const) {
      expect(easeAtProgress(easing, 0)).toBe(0);
      expect(easeAtProgress(easing, 1)).toBe(1);
      let prev = -1;
      for (let i = 0; i <= 100; i++) {
        const v = easeAtProgress(easing, i / 100);
        expect(v).toBeGreaterThanOrEqual(prev);
        expect(v).toBeLessThanOrEqual(1);
        prev = v;
      }
    }
  });

  it("easeOut leads linear at the midpoint; easeIn lags; easeInOut is symmetric", () => {
    expect(easeAtProgress("easeOut", 0.5)).toBeGreaterThan(0.5);
    expect(easeAtProgress("easeIn", 0.5)).toBeLessThan(0.5);
    expect(easeAtProgress("easeInOut", 0.5)).toBeCloseTo(0.5);
    expect(easeAtProgress("linear", 0.5)).toBe(0.5);
  });

  it("clamps out-of-range progress", () => {
    expect(easeAtProgress("easeOut", -1)).toBe(0);
    expect(easeAtProgress("easeIn", 2)).toBe(1);
  });
});

describe("resolveElementTiming — whiteboard draw-on defaults (T4.3)", () => {
  const elements: SceneElementRef[] = [
    { id: "n1", kind: "node", order: 0 },
    { id: "n2", kind: "node", order: 1 },
    { id: "e1", kind: "edge", order: 0 },
  ];

  it("auto-sequences nodes then edges with ease-out when no animations exist", () => {
    const timing = resolveElementTiming([], elements, 5, 30);
    const n1 = timing.get("n1")!;
    const n2 = timing.get("n2")!;
    const e1 = timing.get("e1")!;
    expect(n1.start).toBeLessThan(n2.start);
    expect(n2.start).toBeLessThan(e1.start);
    for (const t of [n1, n2, e1]) {
      expect(t.easing).toBe("easeOut");
      expect(t.type).toBe("draw");
      expect(t.start + t.duration).toBeLessThanOrEqual(5);
    }
  });

  it("explicit animations targeting element ids win over the defaults", () => {
    const timing = resolveElementTiming(
      [
        {
          id: "a1",
          target: "e1",
          type: "draw",
          start: 1.2,
          duration: 0.8,
          easing: "easeInOut",
        },
      ],
      elements,
      5,
      30,
    );
    const e1 = timing.get("e1")!;
    expect(e1.start).toBe(1.2);
    expect(e1.duration).toBe(0.8);
    expect(e1.easing).toBe("easeInOut");
    // untouched elements keep the sequential default
    expect(timing.get("n1")!.start).toBe(0);
  });

  it("elementProgress maps frame → eased progress", () => {
    const timing = resolveElementTiming(
      [
        {
          id: "a1",
          target: "n1",
          type: "draw",
          start: 1,
          duration: 1,
          easing: "linear",
        },
      ],
      [{ id: "n1", kind: "node", order: 0 }],
      5,
      30,
    );
    expect(elementProgress(timing.get("n1")!, 0, 30)).toBe(0);
    expect(elementProgress(timing.get("n1")!, 30, 30)).toBe(0); // start=1s
    expect(elementProgress(timing.get("n1")!, 45, 30)).toBeCloseTo(0.5);
    expect(elementProgress(timing.get("n1")!, 60, 30)).toBe(1);
    expect(elementProgress(timing.get("n1")!, 120, 30)).toBe(1);
  });
});
