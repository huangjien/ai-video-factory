import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runMake, type MakeDeps } from "./index.js";

const ARTICLE = `---
project: run-make
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
  - id: scene_2
    duration: 5
    caption: 二
    visual: 列表要点
    narration: 第二场的话。
\`\`\`
`;

const AUDIO_CONFIG = "voice: zh-CN-YunjianNeural\nbgm: calm\n";

const STEP_ORDER = [
  "sync-storyboard",
  "generate-visuals",
  "tts",
  "sync-durations",
  "captions",
  "audio-assets",
  "render-preview",
  "mix",
] as const;

async function writeProject(root: string): Promise<void> {
  await writeFile(path.join(root, "article.md"), ARTICLE, "utf8");
  await writeFile(path.join(root, "audio-config.yaml"), AUDIO_CONFIG, "utf8");
}

describe("runMake — orchestration through injected process seams", () => {
  let dir: string;
  const calls: string[] = [];

  const fakeDeps: MakeDeps = {
    renderPreview: async () => {
      calls.push("render");
      return ["output/preview.mp4"];
    },
    mix: async () => {
      calls.push("mix");
      return ["output/final-mixed.mp4"];
    },
  };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vf-run-make-"));
    await mkdir(dir, { recursive: true });
    await writeProject(dir);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("runs all eight steps in pipeline order without spawning the CLI", async () => {
    const report = await runMake(
      { projectRoot: dir, fake: true, musicProvider: "mock" },
      fakeDeps,
    );
    expect(report.steps.map((s) => s.name)).toEqual([...STEP_ORDER]);
    expect(report.steps.every((s) => s.status === "ran")).toBe(true);
    expect(calls).toEqual(["render", "mix"]);
    expect(report.steps.find((s) => s.name === "tts")?.outputs).toEqual([
      "assets/audio/scene_1.wav",
      "assets/audio/scene_2.wav",
    ]);
  });

  it("stops at a failed render and never mixes", async () => {
    calls.length = 0;
    const boom: MakeDeps = {
      renderPreview: async () => {
        calls.push("render");
        throw new Error("remotion exploded");
      },
      mix: async () => {
        calls.push("mix");
        return [];
      },
    };
    const report = await runMake(
      { projectRoot: dir, fake: true, musicProvider: "mock" },
      boom,
    );
    const render = report.steps.find((s) => s.name === "render-preview");
    expect(render?.status).toBe("fail");
    expect(render?.message).toContain("remotion exploded");
    expect(report.steps.some((s) => s.name === "mix")).toBe(false);
    expect(calls).toEqual(["render"]);
    const tts = report.steps.find((s) => s.name === "tts");
    expect(tts?.status).toBe("ran");
  });

  it("dry-run marks every step would-run and touches nothing", async () => {
    calls.length = 0;
    const report = await runMake(
      { projectRoot: dir, fake: true, musicProvider: "mock", dryRun: true },
      fakeDeps,
    );
    expect(report.steps.map((s) => s.name)).toEqual([...STEP_ORDER]);
    expect(report.steps.every((s) => s.status === "would-run")).toBe(true);
    expect(calls).toEqual([]);
  });
});
