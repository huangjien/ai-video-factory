import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runMake } from "./index.js";

/** Regression: runTts used to skip on WAV existence, so any re-draft or
 * narration edit kept narrating the OLD text — audio desynced from the
 * picture and subtitles. The cache must key on narration content. */
describe("runTts — narration-hash cache (audio never goes stale)", () => {
  let dir: string;

  const articleOf = (n2: string) => `---
project: tts-cache
language: zh-CN
duration_target_sec: 20
voice: zh-CN-YunjianNeural
---

# 标题

> **Hook** (≤20s): 开场。

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
    narration: ${n2}
\`\`\`
`;

  const audioConfig = "voice: zh-CN-YunjianNeural\nbgm: calm\n";

  const writeInputs = async (n2: string) => {
    await writeFile(path.join(dir, "article.md"), articleOf(n2), "utf8");
    await writeFile(
      path.join(dir, "audio-config.yaml"),
      audioConfig,
      "utf8",
    );
  };

  const wavs = async () =>
    (await readFile(path.join(dir, "assets", "audio", "scene_2.wav")))
      .length;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vf-tts-cache-"));
    await mkdir(path.join(dir, "audio-assets"), { recursive: true });
    await writeInputs("第二场最初的话。");
    await runMake({ projectRoot: dir, fake: true, dryRun: false });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("synthesizes on first run and writes the cache sidecar", async () => {
    const sidecar = await readFile(
      path.join(dir, "assets", "audio", "scene_2.wav.json"),
      "utf8",
    );
    expect(JSON.parse(sidecar).cacheKey).toMatch(/^sha256:/);
  });

  it("skips unchanged narration (no re-synthesis despite step rerun)", async () => {
    await writeInputs("第二场最初的话。");
    const report = await runMake({ projectRoot: dir, fake: true, dryRun: false });
    const tts = report.steps.find((s) => s.name === "tts");
    // Rewriting article.md bumps its mtime, so the STEP may re-run — but
    // the per-scene cache must hold: zero WAVs re-synthesized.
    expect(tts?.outputs ?? []).toEqual([]);
  });

  it("re-synthesizes ONLY the scene whose narration changed", async () => {
    await writeInputs("第二场全新的话，和以前完全不同。");
    const report = await runMake({ projectRoot: dir, fake: true, dryRun: false });
    const tts = report.steps.find((s) => s.name === "tts");
    expect(tts?.status).toBe("ran");
    expect(tts?.outputs).toEqual(["assets/audio/scene_2.wav"]);
    expect(await wavs()).toBeGreaterThan(0);
  });

  it("re-synthesizes a legacy WAV that has no sidecar", async () => {
    await rm(path.join(dir, "assets", "audio", "scene_2.wav.json"));
    const report = await runMake({ projectRoot: dir, fake: true, dryRun: false });
    const tts = report.steps.find((s) => s.name === "tts");
    expect(tts?.outputs).toContain("assets/audio/scene_2.wav");
  });
});
