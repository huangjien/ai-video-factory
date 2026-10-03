import { describe, expect, it } from "vitest";
import { emitSceneAnimations } from "./animation-emitter.js";

const ctx = { sceneDurationSec: 8 };

describe("emitSceneAnimations (T17)", () => {
  it("FlowChart emits one highlight per node + one draw for edges", () => {
    const out = emitSceneAnimations(
      "FlowChart",
      {
        text: "f",
        visual: "v",
        nodes: ["a", "b", "c"],
        direction: "left-to-right",
      },
      ctx,
    );
    expect(out.length).toBe(4); // 3 nodes + 1 edges draw
    expect(out[0]?.target).toBe("node-0");
    expect(out[0]?.type).toBe("highlight");
    expect(out.at(-1)?.target).toBe("__edges__");
    expect(out.at(-1)?.type).toBe("draw");
  });

  it("FlowChart uses the explicit node id when provided", () => {
    const out = emitSceneAnimations(
      "FlowChart",
      {
        nodes: [
          { id: "trigger" },
          { id: "build" },
        ],
      },
      ctx,
    );
    expect(out[0]?.target).toBe("trigger");
    expect(out[1]?.target).toBe("build");
  });

  it("Terminal emits one write (typewriter) animation per line", () => {
    const out = emitSceneAnimations(
      "Terminal",
      { lines: ["a", "b", "c"] },
      ctx,
    );
    expect(out.length).toBe(3);
    expect(out[0]?.target).toBe("line-0");
    expect(out[0]?.type).toBe("write");
    expect(out.at(-1)?.target).toBe("line-2");
  });

  it("Comparison emits two card slides plus per-item highlights", () => {
    const out = emitSceneAnimations(
      "Comparison",
      {
        left: { title: "L", items: ["a", "b"] },
        right: { title: "R", items: ["x"] },
      },
      ctx,
    );
    const targets = out.map((a) => a.target);
    expect(targets).toContain("__left__");
    expect(targets).toContain("__right__");
    expect(targets).toContain("left-item-0");
    expect(targets).toContain("left-item-1");
    expect(targets).toContain("right-item-0");
  });

  it("Timeline emits one highlight per event keyed by label", () => {
    const out = emitSceneAnimations(
      "Timeline",
      { events: [{ label: "2020" }, { label: "2021" }, { label: "2022" }] },
      ctx,
    );
    expect(out.length).toBe(3);
    expect(out[0]?.target).toBe("event-2020");
    expect(out[1]?.target).toBe("event-2021");
  });

  it("Callout emits one highlight for the body", () => {
    const out = emitSceneAnimations(
      "Callout",
      { kind: "warning", title: "T", text: "X" },
      ctx,
    );
    expect(out.length).toBe(1);
    expect(out[0]?.type).toBe("highlight");
  });

  it("SvgScene emits per-node and per-edge animations", () => {
    const out = emitSceneAnimations(
      "SvgScene",
      {
        nodes: [
          { id: "n1", kind: "rect", x: 0, y: 0 },
          { id: "n2", kind: "rect", x: 100, y: 0 },
        ],
        edges: [{ id: "e1", from: "n1", to: "n2" }],
      },
      ctx,
    );
    expect(out.length).toBe(3);
    expect(out[0]?.target).toBe("n1");
    expect(out[1]?.target).toBe("n2");
    expect(out[2]?.target).toBe("e1");
  });

  it("returns empty list for components that don't have a known mapping", () => {
    expect(
      emitSceneAnimations("AnimatedIllustration", { text: "x", visual: "y" }, ctx),
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
      "FlowChart",
      { nodes: ["a", "b", "c", "d", "e"] },
      { sceneDurationSec: 3 },
    );
    const lastAnim = out.at(-1);
    expect(lastAnim).toBeDefined();
    if (!lastAnim) return;
    expect(lastAnim.start + lastAnim.duration).toBeLessThanOrEqual(3.1);
  });
});