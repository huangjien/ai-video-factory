import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendCheckpoint,
  initState,
  writeProjectState,
} from "@video/workflow";
import { loadOrCompileStoryboard, renderPreviewProject } from "./pipeline.js";

const STORYBOARD_YAML = (component: string) => `schema_version: "0.1"
project: {id: pl, language: zh-CN, fps: 30, width: 1920, height: 1080}
scenes:
  - id: a
    duration: 4
    visual: {component: ${component}, props: {text: "a"}}
`;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vf-pipeline-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

async function makeProject(storyboard: string | null): Promise<string> {
  const root = await mkdtemp(path.join(dir, "proj-"));
  await mkdir(path.join(root, "storyboard"), { recursive: true });
  if (storyboard !== null) {
    await writeFile(
      path.join(root, "storyboard", "storyboard.yaml"),
      storyboard,
      "utf8",
    );
  }
  return root;
}

async function approveStoryboard(root: string): Promise<void> {
  const state = initState("pl");
  state.status = "WAITING_REVIEW";
  state.current_stage = "storyboard";
  await writeProjectState(root, state);
  await appendCheckpoint(root, {
    id: "storyboard-approved-test",
    stage: "storyboard",
    status: "approved",
    created_at: new Date().toISOString(),
    approved_at: new Date().toISOString(),
    human_changes: [],
    notes: "",
  });
}

describe("renderPreviewProject — human gate", () => {
  it("fails when there is no storyboard", async () => {
    const root = await makeProject(null);
    const r = await renderPreviewProject(root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("no storyboard");
  });

  it("fails when the project has no state.yaml", async () => {
    const root = await makeProject(STORYBOARD_YAML("Title"));
    const r = await renderPreviewProject(root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("no project state");
  });

  it("blocks rendering until the storyboard checkpoint is approved", async () => {
    const root = await makeProject(STORYBOARD_YAML("Title"));
    const state = initState("pl");
    await writeProjectState(root, state);
    const r = await renderPreviewProject(root);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("");
      expect(r.lines.join("\n")).toContain("storyboard is not approved yet");
      expect(r.lines.join("\n")).toContain("video approve storyboard");
    }
  });

  it("passes the gate with an approved checkpoint, then fails at validation for an unknown component (no render attempted)", async () => {
    const root = await makeProject(STORYBOARD_YAML("NoSuchComponent"));
    await approveStoryboard(root);
    const r = await renderPreviewProject(root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    // The render step must never have produced output dirs.
    expect(existsSync(path.join(root, "output"))).toBe(false);
  });
});

describe("loadOrCompileStoryboard", () => {
  it("compiles the storyboard and persists vdsl.yaml", async () => {
    const root = await makeProject(STORYBOARD_YAML("Title"));
    const { renderPlan, storyboardText, compiledFromVdsl } =
      await loadOrCompileStoryboard(root);
    expect(compiledFromVdsl).toBe(false);
    expect(storyboardText).toContain("component: Title");
    expect(renderPlan.scenes).toHaveLength(1);
    expect(renderPlan.scenes[0]?.startFrame).toBe(0);
    expect(renderPlan.scenes[0]?.id).toBe("a");
    const vdsl = await readFile(path.join(root, "vdsl", "vdsl.yaml"), "utf8");
    expect(vdsl).toContain("schema_version");
  });

  it("reuses a fresh vdsl.yaml instead of recompiling", async () => {
    const root = await makeProject(STORYBOARD_YAML("Title"));
    await loadOrCompileStoryboard(root);
    const second = await loadOrCompileStoryboard(root);
    expect(second.compiledFromVdsl).toBe(true);
    expect(second.renderPlan.scenes).toHaveLength(1);
  });
});
