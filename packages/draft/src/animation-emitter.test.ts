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
describe("emitSceneAnimations — v0.4.2 components", () => {
  it("QuoteBlock emits card highlight + author fade", () => {
    const out = emitSceneAnimations(
      "QuoteBlock",
      { quote: "q", author: "a" },
      ctx,
    );
    expect(out.map((a) => a.target)).toEqual(["__quote__", "__author__"]);
  });

  it("StatGrid emits one scale per stat", () => {
    const out = emitSceneAnimations(
      "StatGrid",
      { stats: [{ value: "1", label: "a" }, { value: "2", label: "b" }] },
      ctx,
    );
    expect(out.map((a) => a.target)).toEqual(["stat-0", "stat-1"]);
    expect(out[0]?.type).toBe("scale");
  });

  it("BarChart emits one draw per bar", () => {
    const out = emitSceneAnimations(
      "BarChart",
      { bars: [{ label: "a", value: 1 }, { label: "b", value: 2 }] },
      ctx,
    );
    expect(out.map((a) => a.target)).toEqual(["bar-0", "bar-1"]);
    expect(out[0]?.type).toBe("draw");
  });

  it("Leaderboard reveals bottom-up (last rank first)", () => {
    const out = emitSceneAnimations(
      "Leaderboard",
      { entries: [{ name: "a" }, { name: "b" }, { name: "c" }] },
      ctx,
    );
    expect(out.map((a) => a.target)).toEqual(["rank-0", "rank-1", "rank-2"]);
    expect(out[0]!.start).toBeGreaterThan(out[2]!.start);
  });

  it("Checklist emits one highlight per item", () => {
    const out = emitSceneAnimations(
      "Checklist",
      { items: [{ text: "a" }, { text: "b" }] },
      ctx,
    );
    expect(out.map((a) => a.target)).toEqual(["item-0", "item-1"]);
  });

  it("BigIdea emits a single linear write reveal", () => {
    const out = emitSceneAnimations("BigIdea", { text: "idea" }, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]?.target).toBe("__reveal__");
    expect(out[0]?.type).toBe("write");
    expect(out[0]?.easing).toBe("linear");
  });

  it("PyramidDiagram draws bottom-up", () => {
    const out = emitSceneAnimations(
      "PyramidDiagram",
      { levels: ["top", "mid", "base"] },
      ctx,
    );
    expect(out.map((a) => a.target)).toEqual(["level-0", "level-1", "level-2"]);
    expect(out[0]!.start).toBeGreaterThan(out[2]!.start);
  });

  it("VennDiagram fades each set", () => {
    const out = emitSceneAnimations(
      "VennDiagram",
      { sets: ["a", "b", "c"] },
      ctx,
    );
    expect(out.map((a) => a.target)).toEqual(["set-0", "set-1", "set-2"]);
    expect(out[0]?.type).toBe("fade");
  });

  it("CycleDiagram draws the ring then lights each stage", () => {
    const out = emitSceneAnimations(
      "CycleDiagram",
      { stages: ["a", "b", "c"] },
      ctx,
    );
    expect(out[0]?.target).toBe("__ring__");
    expect(out[0]?.type).toBe("draw");
    expect(out.slice(1).map((a) => a.target)).toEqual([
      "stage-0",
      "stage-1",
      "stage-2",
    ]);
  });

  it("v0.4.2 animations all fit inside a short scene", () => {
    for (const [component, props] of [
      ["StatGrid", { stats: [{ value: "1", label: "a" }] }],
      ["BarChart", { bars: [{ label: "a", value: 1 }] }],
      ["Leaderboard", { entries: [{ name: "a" }] }],
      ["Checklist", { items: [{ text: "a" }] }],
      ["PyramidDiagram", { levels: ["a", "b"] }],
      ["VennDiagram", { sets: ["a"] }],
      ["CycleDiagram", { stages: ["a"] }],
    ] as const) {
      const out = emitSceneAnimations(component, props, { sceneDurationSec: 3 });
      for (const a of out) {
        expect(a.start + a.duration).toBeLessThanOrEqual(3.1);
      }
    }
  });
});
