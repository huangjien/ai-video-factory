import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANIMATION_ENTRANCES, TRANSITIONS } from "./schema.js";
import { validateStoryboard } from "./validate.js";
import { compileStoryboard } from "./compile.js";
import { validStoryboardYaml } from "./test-fixtures.js";

const minimal = (duration: number) => `schema_version: "0.1"
project: {id: t, language: zh-CN, fps: 30, width: 1920, height: 1080}
scenes:
  - id: a
    duration: ${duration}
    visual: {component: Title, props: {text: "a"}}
  - id: b
    duration: 4
    visual: {component: Paragraph, props: {text: "b"}}
`;

describe("compileStoryboard — frame math + RenderPlan", () => {
  it("computes startFrames and totalFrames from scene durations", () => {
    const text = `schema_version: "0.1"
project: {id: t, language: zh-CN, fps: 30, width: 1920, height: 1080}
scenes:
  - id: a
    duration: 8
    visual: {component: Title, props: {text: "a"}}
  - id: b
    duration: 4
    visual: {component: Paragraph, props: {text: "b"}}
  - id: c
    duration: 12
    visual: {component: Title, props: {text: "c"}}
`;
    const { renderPlan } = compileStoryboard(text, "/proj");
    expect(renderPlan.totalFrames).toBe(720);
    expect(renderPlan.scenes.map((s) => s.startFrame)).toEqual([0, 240, 360]);
    expect(renderPlan.scenes.map((s) => s.durationInFrames)).toEqual([
      240, 120, 360,
    ]);
  });

  it("round-trips the normalized vdsl.yaml through validateStoryboard", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vf-compile-"));
    const { write } = compileStoryboard(validStoryboardYaml, root);
    await write();
    const vdslPath = path.join(root, "vdsl", "vdsl.yaml");
    const written = readFileSync(vdslPath, "utf8");
    const result = validateStoryboard(written, "vdsl.yaml");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Defaults filled — every scene has animation + transition
      for (const scene of result.data.scenes) {
        expect(scene.animation?.entrance).toBeTruthy();
        expect(scene.animation?.emphasis).toBe("none");
      }
    }
  });

  it("is deterministic: re-compiling identical input yields byte-identical vdsl.yaml", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vf-compile-"));
    const { write } = compileStoryboard(validStoryboardYaml, root);
    await write();
    const first = readFileSync(path.join(root, "vdsl", "vdsl.yaml"), "utf8");
    // second compile pass
    const { write: write2 } = compileStoryboard(first, root);
    await write2();
    const second = readFileSync(path.join(root, "vdsl", "vdsl.yaml"), "utf8");
    expect(second).toBe(first);
  });

  it("refuses invalid input (shape fail)", () => {
    expect(() => compileStoryboard("not: valid: vdsl", "/proj")).toThrow();
  });

  it("wraps captions via wrapText in the render plan", () => {
    const { renderPlan } = compileStoryboard(validStoryboardYaml, "/proj");
    const first = renderPlan.scenes[0];
    expect(first?.captions?.lines).toBeDefined();
    expect(first?.captions?.lines.length).toBeGreaterThan(0);
  });

  it("exposes ANIMATION_ENTRANCES and TRANSITIONS constants", () => {
    expect(ANIMATION_ENTRANCES).toContain("fade");
    expect(TRANSITIONS).toContain("cut");
  });

  it("handles empty optional blocks without crashing", () => {
    const text = minimal(8);
    const { renderPlan } = compileStoryboard(text, "/proj");
    expect(renderPlan.scenes[0]?.animation.entrance).toBe("none");
    expect(renderPlan.scenes[0]?.captions).toBeNull();
    expect(renderPlan.scenes[0]?.audio).toBeNull();
  });
});
