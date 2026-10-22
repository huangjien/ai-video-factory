import { describe, expect, it } from "vitest";
import { preserveMotionPlan } from "./index.js";

/**
 * The motion plan lives in storyboard.yaml, which is DERIVED from
 * article.md. Re-deriving it (a changed scene count, a corrupt file, a
 * hand re-derive) used to drop the plan silently — and with it the
 * still-frame setting, so the "still" shots started drifting again with
 * nothing in the log to say so.
 */
describe("preserveMotionPlan — a re-derivation must not drop the plan", () => {
  const prev = {
    scenes: [
      {
        id: "scene-01",
        visual: { component: "ImageBackground", props: { kenBurnsScale: 0 } },
        animations: [],
        transition: { in: "fade", out: "cut" },
      },
      {
        id: "scene-02",
        visual: { component: "ImageBackground", props: { kenBurnsScale: 0 } },
        animations: [],
        transition: { in: "fade", out: "cut" },
      },
    ],
  };

  it("carries the plan onto scenes that exist in both copies", () => {
    const next: { scenes: Record<string, unknown>[] } = {
      scenes: [
        {
          id: "scene-01",
          visual: { component: "ImageBackground", props: {} },
        },
        {
          id: "scene-02",
          visual: { component: "ImageBackground", props: {} },
        },
      ],
    };
    const kept = preserveMotionPlan(next, prev);
    expect(kept).toBeGreaterThan(0);
    const s1 = next.scenes[0]!;
    expect(s1["animations"]).toEqual([]);
    expect(s1["transition"]).toEqual({ in: "fade", out: "cut" });
    expect(
      (s1["visual"] as { props: Record<string, unknown> }).props[
        "kenBurnsScale"
      ],
    ).toBe(0);
  });

  it("leaves a new scene without a plan", () => {
    const next: { scenes: Record<string, unknown>[] } = {
      scenes: [
        { id: "scene-01", visual: { component: "ImageBackground", props: {} } },
        { id: "scene-09", visual: { component: "ImageBackground", props: {} } },
      ],
    };
    preserveMotionPlan(next, prev);
    const added = next.scenes[1]!;
    expect(added["animations"]).toBeUndefined();
    expect(added["transition"]).toBeUndefined();
    expect(
      (added["visual"] as { props: Record<string, unknown> }).props[
        "kenBurnsScale"
      ],
    ).toBeUndefined();
  });

  it("does not overwrite a plan the new copy already has", () => {
    const next: { scenes: Record<string, unknown>[] } = {
      scenes: [
        {
          id: "scene-01",
          visual: {
            component: "ImageBackground",
            props: { kenBurnsScale: 0.015 },
          },
          animations: [{ id: "x" }],
          transition: { in: "cut", out: "cut" },
        },
      ],
    };
    preserveMotionPlan(next, prev);
    const s1 = next.scenes[0]!;
    expect(s1["animations"]).toEqual([{ id: "x" }]);
    expect(s1["transition"]).toEqual({ in: "cut", out: "cut" });
    expect(
      (s1["visual"] as { props: Record<string, unknown> }).props[
        "kenBurnsScale"
      ],
    ).toBe(0.015);
  });
});
