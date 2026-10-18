import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initState, writeProjectState } from "@video/workflow";
import { runMakeCli } from "./make-command.js";

const ARTICLE = `---
project: mk-demo
language: zh-CN
duration_target_sec: 12
voice: zh-CN-YunjianNeural
---

# 标题

> **Hook** (≤12s): 开场。

## 1. 第一节

正文一。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 5
    caption: 一
    visual: 列表要点
    narration: 第一场的话。
\`\`\`
`;

let projectsRoot: string;

beforeAll(async () => {
  projectsRoot = await mkdtemp(path.join(tmpdir(), "vf-make-cmd-"));
  const proj = path.join(projectsRoot, "projects", "mk-demo");
  await mkdir(path.join(proj, "storyboard"), { recursive: true });
  await writeProjectState(proj, initState("mk-demo"));
  await writeFile(path.join(proj, "article.md"), ARTICLE, "utf8");
  await writeFile(
    path.join(proj, "audio-config.yaml"),
    "voice: zh-CN-YunjianNeural\nbgm: calm\n",
    "utf8",
  );
});

afterAll(async () => {
  await rm(projectsRoot, { recursive: true, force: true }).catch(() => {});
});

describe("runMakeCli", () => {
  it("fails with exit 1 on an unknown project", async () => {
    const code = await runMakeCli({
      project: "no-such-project",
      cwd: projectsRoot,
      dryRun: true,
    });
    expect(code).toBe(1);
  });

  it("dry-run plans every step, executes nothing, exits 0", async () => {
    const code = await runMakeCli({
      project: "mk-demo",
      cwd: projectsRoot,
      fake: true,
      dryRun: true,
    });
    expect(code).toBe(0);
    // Dry-run must not materialize any pipeline outputs.
    expect(existsSync(path.join(projectsRoot, "projects", "mk-demo", "assets"))).toBe(
      false,
    );
    expect(
      existsSync(path.join(projectsRoot, "projects", "mk-demo", "captions")),
    ).toBe(false);
  });
});
