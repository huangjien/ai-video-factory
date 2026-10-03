import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runNew } from "./new-command.js";
import { runExcalidraw } from "./excalidraw-command.js";

const STORYBOARD = `schema_version: "0.2"

project:
  id: excalidraw-demo
  language: zh-CN
  fps: 30
  width: 640
  height: 360

scenes:
  - id: scene-01
    duration: 4
    narration:
      text: "部署流水线"
    visual:
      renderer: svg
      component: SvgScene
      props:
        title: "DevOps 部署流"
        nodes:
          - id: ci
            kind: rect
            x: 100
            y: 160
            w: 240
            h: 120
            text: "CI"
          - id: db
            kind: circle
            x: 440
            y: 160
            w: 160
            h: 120
            text: "DB"
        edges:
          - id: deploy
            from: ci
            to: db
            label: "deploy"
`;

describe("video excalidraw (T7.1) — end to end on a project", () => {
  let cwd: string;
  let projectDir: string;

  beforeEach(async () => {
    cwd = mkdtempSync(path.join(tmpdir(), "video-excalidraw-cli-"));
    await runNew({ projectId: "excalidraw-demo", cwd });
    projectDir = path.join(cwd, "projects", "excalidraw-demo");
    writeFileSync(
      path.join(projectDir, "storyboard", "storyboard.yaml"),
      STORYBOARD,
    );
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("writes .excalidraw + animated .svg per SvgScene", async () => {
    const code = await runExcalidraw({ project: "excalidraw-demo", cwd });
    expect(code).toBe(0);
    const ex = path.join(projectDir, "assets", "excalidraw", "scene-01.excalidraw");
    const svg = path.join(projectDir, "assets", "excalidraw", "scene-01.svg");
    expect(existsSync(ex)).toBe(true);
    expect(existsSync(svg)).toBe(true);
    const scene = JSON.parse(readFileSync(ex, "utf8"));
    expect(scene.type).toBe("excalidraw");
    expect(scene.elements.length).toBeGreaterThanOrEqual(4);
    const svgText = readFileSync(svg, "utf8");
    expect(svgText).toContain("video-draw");
  });

  it("exits 1 when the storyboard has no svg scenes", async () => {
    writeFileSync(
      path.join(projectDir, "storyboard", "storyboard.yaml"),
      `schema_version: "0.1"\nproject:\n  id: excalidraw-demo\n  language: zh-CN\n  fps: 30\n  width: 640\n  height: 360\nscenes:\n  - id: scene-01\n    duration: 3\n    narration:\n      text: "x"\n    visual:\n      component: Title\n      props:\n        text: "t"\n`,
    );
    expect(
      await runExcalidraw({ project: "excalidraw-demo", cwd }),
    ).toBe(1);
  });
});
