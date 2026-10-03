import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runNew } from "./new-command.js";
import { runApprove } from "./workflow-commands.js";
import { runMotion } from "./motion-command.js";
import { listSceneVersions } from "@video/workflow";

/**
 * video motion integration (T4.2) — exercises the CLI wiring with the
 * deterministic baseline (no network). The LLM path itself is covered by
 * packages/motion/src/agent.test.ts with fake providers.
 */

const STORYBOARD = `schema_version: "0.1"

project:
  id: motion-demo
  language: zh-CN
  fps: 30
  width: 640
  height: 360

scenes:
  - id: scene-01
    duration: 4
    narration:
      text: "第一段"
    visual:
      component: Title
      props:
        text: "hello"
  - id: scene-02
    duration: 8
    narration:
      text: "第二段"
    visual:
      component: FlowChart
      props:
        steps: ["a", "b"]
`;

describe("video motion (T4.2)", () => {
  let cwd: string;
  let projectDir: string;
  let projectName: string;

  beforeEach(async () => {
    cwd = mkdtempSync(path.join(tmpdir(), "video-motion-cmd-"));
    const slug = "motion-demo";
    await runNew({ projectId: slug, cwd });
    projectDir = path.join(cwd, "projects", slug);
    projectName = slug;
    writeFileSync(path.join(projectDir, "storyboard", "storyboard.yaml"), STORYBOARD);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("plans motion with the deterministic baseline and versions the scenes", async () => {
    const code = await runMotion({ project: projectName, cwd, baseline: true });
    expect(code).toBe(0);
    const sb = readFileSync(
      path.join(projectDir, "storyboard", "storyboard.yaml"),
      "utf8",
    );
    expect(sb).toContain("animations:");
    expect(sb).toContain("transition:");
    // component-driven entrance: FlowChart draws on
    expect(sb).toContain("type: draw");
    // 8s scene earns a mid-scene highlight
    expect(sb).toContain("type: highlight");
    // versions recorded for both scenes
    expect(
      (await listSceneVersions(projectDir, "scene-01")).map((v) => v.version),
    ).toEqual([1]);
    // run record directory exists
    expect(existsSync(path.join(projectDir, "runs"))).toBe(true);
  }, 60_000);

  it("is idempotent — a second baseline run changes nothing", async () => {
    await runMotion({ project: projectName, cwd, baseline: true });
    const sb1 = readFileSync(
      path.join(projectDir, "storyboard", "storyboard.yaml"),
      "utf8",
    );
    const versions1 = await listSceneVersions(projectDir, "scene-01");
    const code = await runMotion({ project: projectName, cwd, baseline: true });
    expect(code).toBe(0);
    const sb2 = readFileSync(
      path.join(projectDir, "storyboard", "storyboard.yaml"),
      "utf8",
    );
    expect(sb2).toBe(sb1);
    expect((await listSceneVersions(projectDir, "scene-01")).length).toBe(
      versions1.length,
    );
  }, 60_000);

  it("refuses an approved storyboard without --force", async () => {
    await runMotion({ project: projectName, cwd, baseline: true });
    const approved = await runApprove(projectName, "storyboard", cwd);
    expect(approved).toBe(0);
    const refused = await runMotion({ project: projectName, cwd, baseline: true });
    expect(refused).toBe(1);
    const forced = await runMotion({
      project: projectName,
      cwd,
      baseline: true,
      force: true,
    });
    expect(forced).toBe(0);
  }, 60_000);

  it("plans a single scene with --scene and errors on unknown ids", async () => {
    const one = await runMotion({
      project: projectName,
      cwd,
      baseline: true,
      scene: "scene-02",
    });
    expect(one).toBe(0);
    const sb = readFileSync(
      path.join(projectDir, "storyboard", "storyboard.yaml"),
      "utf8",
    );
    expect(sb.match(/animations:/g)).toHaveLength(1);
    const bad = await runMotion({
      project: projectName,
      cwd,
      baseline: true,
      scene: "nope",
    });
    expect(bad).toBe(1);
  }, 60_000);
});
