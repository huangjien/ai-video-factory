import { describe, expect, it } from "vitest";
import { lookupTiming, progressFor } from "./timelineTiming.js";

describe("timelineTiming (T19)", () => {
  it("lookupTiming returns null when animations is undefined", () => {
    expect(lookupTiming(undefined, "x")).toBeNull();
  });

  it("lookupTiming returns null when target is absent", () => {
    expect(
      lookupTiming(
        [{ id: "a", target: "y", type: "highlight", start: 0, duration: 1, easing: "easeOut" }],
        "x",
      ),
    ).toBeNull();
  });

  it("lookupTiming returns the first matching animation for the target", () => {
    const a = [
      { id: "a1", target: "x", type: "highlight", start: 0.5, duration: 1, easing: "easeOut" },
      { id: "a2", target: "x", type: "draw", start: 0.5, duration: 2, easing: "easeOut" },
    ];
    const t = lookupTiming(a, "x");
    expect(t).not.toBeNull();
    expect(t?.type).toBe("highlight");
    expect(t?.start).toBe(0.5);
    expect(t?.duration).toBe(1);
  });

  it("progressFor returns 0 before the animation start", () => {
    expect(
      progressFor(
        [{ id: "a", target: "x", type: "highlight", start: 2, duration: 1, easing: "easeOut" }],
        "x",
        1,
      ),
    ).toBe(0);
  });

  it("progressFor returns 1 at or past end of animation", () => {
    expect(
      progressFor(
        [{ id: "a", target: "x", type: "highlight", start: 1, duration: 2, easing: "easeOut" }],
        "x",
        10,
      ),
    ).toBe(1);
  });

  it("progressFor returns eased value during the animation", () => {
    const p = progressFor(
      [{ id: "a", target: "x", type: "highlight", start: 0, duration: 1, easing: "easeOut" }],
      "x",
      0.5,
    );
    expect(p).toBeGreaterThan(0.5); // easeOut overshoots midpoint
    expect(p).toBeLessThan(1);
  });

  it("progressFor falls back to 0.5s default when target is missing", () => {
    const at = progressFor(undefined, "x", 0.5, 0.5);
    // progress = (0.5 - 0) / 0.5 = 1.0 → eased to 1
    expect(at).toBe(1);
    const before = progressFor(undefined, "x", 0.1, 0.5);
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(1);
  });
});