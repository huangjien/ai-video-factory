import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArticleWithRecovery } from "@video/draft";
import { generateSceneVisuals } from "./index.js";
import { computeMakeImpact, formatImpact } from "./impact.js";
import { fileSha256 } from "./visual-cache.js";

/**
 * v0.8 plan G2: the dry-run impact report is read-only and mirrors the
 * caches exactly — it must predict what make would spend, without
 * constructing a provider or writing a byte.
 */

const ARTICLE = `---
project: impact
language: zh-CN
duration_target_sec: 12
voice: zh-CN-YunjianNeural
---

# 标题

## 1. 第一节

正文。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 5
    caption: 一
    visual: 列表要点甲
    narration: 第一句。
  - id: scene_2
    duration: 5
    caption: 二
    visual: 对比要点乙
    narration: 第二句。
\`\`\`
`;

async function mkProject(article = ARTICLE): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "impact-"));
  await mkdir(path.join(dir, "assets", "images"), { recursive: true });
  await writeFile(path.join(dir, "article.md"), article, "utf8");
  await writeFile(
    path.join(dir, "audio-config.yaml"),
    "voice: zh-CN-YunjianNeural\nbgm: calm\n",
    "utf8",
  );
  return dir;
}

describe("computeMakeImpact", () => {
  it("fresh project: everything generates/synthesizes/renders", async () => {
    const dir = await mkProject();
    try {
      const impact = computeMakeImpact(dir, { imageProvider: "mock" });
      expect(impact.imageGenerate).toEqual([1, 2]);
      expect(impact.ttsSynthesize).toEqual(["scene_1", "scene_2"]);
      expect(impact.scenesRender[0]).toContain("no storyboard");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("after generation: images report cached; edited visual predicts regenerate", async () => {
    const dir = await mkProject();
    try {
      await generateSceneVisuals(
        dir,
        parseArticleWithRecovery(ARTICLE).article,
        { provider: "mock" },
      );
      const clean = computeMakeImpact(dir, { imageProvider: "mock" });
      expect(clean.imageCached).toEqual([1, 2]);
      expect([...clean.imageGenerate, ...clean.imageRegenerate]).toEqual([]);

      const edited = ARTICLE.replace("对比要点乙", "对比要点乙（改）");
      await writeFile(path.join(dir, "article.md"), edited, "utf8");
      const impact = computeMakeImpact(dir, { imageProvider: "mock" });
      expect(impact.imageRegenerate).toEqual([2]);
      expect(impact.imageCached).toEqual([1]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("visuals gate: missing checkpoint, then ok, then stale after image bytes change", async () => {
    const dir = await mkProject(
      ARTICLE.replace(
        "voice: zh-CN-YunjianNeural\n---",
        "voice: zh-CN-YunjianNeural\nrequire_visual_approval: true\n---",
      ),
    );
    try {
      await generateSceneVisuals(
        dir,
        parseArticleWithRecovery(
          ARTICLE.replace(
            "voice: zh-CN-YunjianNeural\n---",
            "voice: zh-CN-YunjianNeural\nrequire_visual_approval: true\n---",
          ),
        ).article,
        { provider: "mock" },
      );

      // No checkpoint yet → gate blocks with the fix hint.
      expect(computeMakeImpact(dir, { imageProvider: "mock" }).visualsGate)
        .toEqual({ required: true, state: "missing-checkpoint", staleScenes: [] });

      // Approve the current set (write the checkpoint the way G4 will).
      const scenes: Record<string, { hash: string }> = {};
      for (const n of [1, 2]) {
        const sha = fileSha256(path.join(dir, "assets", "images", `scene_${n}.jpg`));
        if (sha) scenes[`scene_${n}`] = { hash: sha };
      }
      await mkdir(path.join(dir, "checkpoints"), { recursive: true });
      await writeFile(
        path.join(dir, "checkpoints", "visuals.yaml"),
        `schema: visuals-checkpoint/1\nscenes:\n` +
          Object.entries(scenes)
            .map(([k, v]) => `  ${k}: { hash: ${v.hash} }`)
            .join("\n") +
          "\n",
        "utf8",
      );
      expect(computeMakeImpact(dir, { imageProvider: "mock" }).visualsGate)
        .toEqual({ required: true, state: "ok", staleScenes: [] });

      // Tamper with one image (e.g. manual edit) → gate reports it stale.
      await writeFile(
        path.join(dir, "assets", "images", "scene_2.jpg"),
        Buffer.from("tampered"),
      );
      expect(computeMakeImpact(dir, { imageProvider: "mock" }).visualsGate)
        .toEqual({ required: true, state: "stale", staleScenes: [2] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("storyboard drift: article narration changed but ids match → surfaced", async () => {
    const dir = await mkProject();
    try {
      await mkdir(path.join(dir, "storyboard"), { recursive: true });
      await writeFile(
        path.join(dir, "storyboard", "storyboard.yaml"),
        `scenes:\n  - id: scene-01\n    narration:\n      text: |\n        旧的第一句。\n  - id: scene-02\n    narration:\n      text: |\n        第二句。\n`,
        "utf8",
      );
      const impact = computeMakeImpact(dir, { imageProvider: "mock" });
      expect(impact.storyboardDrift).toEqual(["scene_1"]);
      expect(formatImpact(impact).join("\n")).toContain("storyboard drift: scene_1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
