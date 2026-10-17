/**
 * Regression tests for `slicePlanScene` absolute-frame offset
 * (2026-10-16 bug: the brand intro band showed in nearly every scene).
 * Per-scene renders rebase `useCurrentFrame()` to 0, so the sliced plan
 * must carry the scene's original startFrame — otherwise absolute-time
 * overlays (BrandIntro's intro window) restart at every scene.
 */
import { describe, expect, it } from "vitest";
import type { RenderPlan, RenderPlanScene } from "./compile.js";
import { slicePlanScene } from "./compile.js";

function planWithTwoScenes(): RenderPlan {
  const project = {
    id: "t",
    language: "zh-CN",
    fps: 30,
    width: 1920,
    height: 1080,
  } as RenderPlan["project"];
  const scene = (
    id: string,
    index: number,
    startFrame: number,
  ): RenderPlanScene => ({
    id,
    index,
    startFrame,
    durationInFrames: 90,
    component: "Title",
    renderer: "remotion",
    props: {},
    animation: { entrance: "fade", emphasis: "none", exit: "fade" },
    animations: [],
    transition: null,
    captions: null,
    audio: null,
  });
  return {
    project,
    style: { theme: "paper-light" },
    totalFrames: 180,
    scenes: [scene("scene-01", 0, 0), scene("scene-02", 1, 90)],
  };
}

// RenderPlanScene is exported from compile.ts — used directly above.

describe("slicePlanScene frame offset", () => {
  it("records the original startFrame as frameOffsetFrames", () => {
    const plan = planWithTwoScenes();
    const { plan: sliced } = slicePlanScene(plan, "scene-02");
    expect(sliced.frameOffsetFrames).toBe(90);
    // The sliced scene itself still starts at local frame 0.
    expect(sliced.scenes[0]?.startFrame).toBe(0);
    expect(sliced.totalFrames).toBe(90);
    expect(sliced.scenes).toHaveLength(1);
  });

  it("scene-01 (offset 0) yields frameOffsetFrames 0 — falsy-safe", () => {
    const plan = planWithTwoScenes();
    const { plan: sliced } = slicePlanScene(plan, "scene-01");
    expect(sliced.frameOffsetFrames).toBe(0);
  });
});
