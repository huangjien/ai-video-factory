import { describe, expect, it } from "vitest";
import { emitSceneAnimations } from "./animation-emitter.js";

const ctx = { sceneDurationSec: 8 };

describe("emitSceneAnimations (T17)", () => {
  it("returns empty list for components that don't have a known mapping", () => {
    expect(
      emitSceneAnimations(
        "AnimatedIllustration",
        { text: "x", visual: "y" },
        ctx,
      ),
    ).toEqual([]);
  });

  it("all emitted animations have non-negative start + duration", () => {
    const out = emitSceneAnimations(
      "FlowChart",
      { nodes: ["a", "b", "c", "d"] },
      ctx,
    );
    for (const a of out) {
      expect(a.start).toBeGreaterThanOrEqual(0);
      expect(a.duration).toBeGreaterThan(0);
      expect(a.easing).toMatch(/linear|easeIn|easeOut|easeInOut/);
    }
  });

  it("respects scene duration so animations fit inside the scene", () => {
    const out = emitSceneAnimations(
      "Title",
      { text: "opening" },
      { sceneDurationSec: 3 },
    );
    const lastAnim = out.at(-1);
    expect(lastAnim).toBeDefined();
    if (!lastAnim) return;
    expect(lastAnim.start + lastAnim.duration).toBeLessThanOrEqual(3.1);
  });
});
