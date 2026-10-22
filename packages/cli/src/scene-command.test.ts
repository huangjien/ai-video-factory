import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  initState,
  writeProjectState,
  recordSceneVersion,
  readSceneApproval,
} from "@video/workflow";
import {
  runSceneApprove,
  runSceneList,
  runSceneRestore,
} from "./scene-command.js";

const STORYBOARD = `schema_version: "0.1"
project: {id: sc, language: zh-CN, fps: 30, width: 1920, height: 1080}
scenes:
  - id: a
    duration: 4
    visual: {component: Title, props: {text: "original a"}}
  - id: b
    duration: 4
    visual: {component: Paragraph, props: {text: "b"}}
`;

let projectsRoot: string;
let proj: string;

beforeAll(async () => {
  projectsRoot = await mkdtemp(path.join(tmpdir(), "vf-scene-cmd-"));
  proj = path.join(projectsRoot, "projects", "sc-demo");
  await mkdir(path.join(proj, "storyboard"), { recursive: true });
  await writeProjectState(proj, initState("sc-demo"));
  await writeFile(
    path.join(proj, "storyboard", "storyboard.yaml"),
    STORYBOARD,
    "utf8",
  );
});

afterAll(async () => {
  await rm(projectsRoot, { recursive: true, force: true }).catch(() => {});
  vi.restoreAllMocks();
});

describe("runSceneList", () => {
  it("fails on an unknown project", async () => {
    expect(await runSceneList("ghost", undefined, projectsRoot)).toBe(1);
  });

  it("reports no versions for a never-previewed scene", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    const code = await runSceneList("sc-demo", "a", projectsRoot);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("no versions recorded yet");
  });

  it("lists every scene id found in the storyboard", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    const code = await runSceneList("sc-demo", undefined, projectsRoot);
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("a:");
    expect(out).toContain("b:");
    expect(out).toContain("no versions yet");
  });

  it("fails without a storyboard", async () => {
    const bare = path.join(projectsRoot, "projects", "sc-bare");
    await mkdir(path.join(bare, "storyboard"), { recursive: true });
    await writeProjectState(bare, initState("sc-bare"));
    expect(await runSceneList("sc-bare", undefined, projectsRoot)).toBe(1);
  });
});

describe("runSceneRestore", () => {
  it("fails for a version that was never recorded", async () => {
    const code = await runSceneRestore("sc-demo", "a", 99, projectsRoot);
    expect(code).toBe(1);
  });

  it("restores the old fragment, records the revert, and drops that scene's caches", async () => {
    // v1 = original content (auto-recorded from the storyboard).
    const v1 = await recordSceneVersion(
      proj,
      "a",
      `  - id: a
    duration: 4
    visual: {component: Title, props: {text: "original a"}}
`,
    );
    expect(v1).toBe(1);

    // Human edits scene a; the new content becomes v2.
    const edited = STORYBOARD.replace('"original a"', '"edited a"');
    await writeFile(
      path.join(proj, "storyboard", "storyboard.yaml"),
      edited,
      "utf8",
    );
    await recordSceneVersion(
      proj,
      "a",
      `  - id: a
    duration: 4
    visual: {component: Title, props: {text: "edited a"}}
`,
    );

    // Stale render caches for scene a only.
    const scenesDir = path.join(proj, "scenes");
    await mkdir(scenesDir, { recursive: true });
    const cacheA = path.join(scenesDir, "00-a.mp4");
    const cacheAJson = `${cacheA}.json`;
    const cacheB = path.join(scenesDir, "01-b.mp4");
    await writeFile(cacheA, "x", "utf8");
    await writeFile(cacheAJson, "{}", "utf8");
    await writeFile(cacheB, "x", "utf8");

    const code = await runSceneRestore("sc-demo", "a", 1, projectsRoot);
    expect(code).toBe(0);

    const text = await readFile(
      path.join(proj, "storyboard", "storyboard.yaml"),
      "utf8",
    );
    expect(text).toContain('"original a"');
    expect(text).not.toContain('"edited a"');
    expect(text).toContain('"b"'); // untouched

    expect(existsSync(cacheA)).toBe(false);
    expect(existsSync(cacheAJson)).toBe(false);
    expect(existsSync(cacheB)).toBe(true); // other scenes keep their caches
  });
});

describe("runSceneApprove", () => {
  it("fails for a scene that is not in the storyboard", async () => {
    const code = await runSceneApprove(
      "sc-demo",
      "zzz",
      undefined,
      undefined,
      projectsRoot,
    );
    expect(code).toBe(1);
  });

  it("approves the version matching the current content (recording it if needed)", async () => {
    const code = await runSceneApprove(
      "sc-demo",
      "a",
      undefined,
      undefined,
      projectsRoot,
    );
    expect(code).toBe(0);
    const approval = await readSceneApproval(proj, "a");
    expect(approval).not.toBeNull();
    expect(approval?.version).toBeGreaterThanOrEqual(1);
    expect(approval?.approver).toBe("human");
  });

  it("approves an explicit version number", async () => {
    const code = await runSceneApprove(
      "sc-demo",
      "a",
      1,
      "looks good",
      projectsRoot,
    );
    expect(code).toBe(0);
    const approval = await readSceneApproval(proj, "a");
    expect(approval?.version).toBe(1);
  });
});
