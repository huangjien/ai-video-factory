import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateSceneVisuals } from "./index.js";
import { imageCacheKey } from "./visual-cache.js";
import { parseArticleWithRecovery } from "@video/draft";

/**
 * v0.8 visual-guardrails regression tests (plan G1).
 *
 * G1's reason to exist: before v0.8 the image cache keyed on file
 * EXISTENCE — an edited `visual:` line never regenerated its image.
 */

function articleMd(visual2: string, extraFrontmatter = ""): string {
  return `---
project: visual-cache
language: zh-CN
duration_target_sec: 12
voice: zh-CN-YunjianNeural
${extraFrontmatter}---

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
    visual: ${visual2}
    narration: 第二句。
\`\`\`
`;
}

async function mkProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "visual-cache-"));
  await mkdir(path.join(dir, "assets", "images"), { recursive: true });
  return dir;
}

const OPTS = {
  provider: "mock" as const,
};

/** Labels of generations that actually STARTED (progress events are the
 * strongest regeneration signal — mock output is prompt-deterministic, so
 * a style/ref flip fires invalidation but can yield identical bytes). */
async function generatedLabels(
  dir: string,
  article: ReturnType<typeof parseArticleWithRecovery>["article"],
): Promise<string[]> {
  const labels: string[] = [];
  await generateSceneVisuals(dir, article, {
    ...OPTS,
    onEvent: (e) => {
      if (e.kind === "start") labels.push(e.label);
    },
  });
  return labels;
}

describe("G1: content-keyed image cache", () => {
  it("regenerates ONLY the scene whose visual changed (regression: today it never regenerates)", async () => {
    const dir = await mkProject();
    try {
      const gen1 = await generateSceneVisuals(
        dir,
        parseArticleWithRecovery(articleMd("对比要点乙")).article,
        OPTS,
      );
      expect(gen1.join("\n")).toContain("scene_1.jpg");
      const jpg1 = await readFile(path.join(dir, "assets/images/scene_1.jpg"));
      const jpg2 = await readFile(path.join(dir, "assets/images/scene_2.jpg"));

      // Edit scene 2's visual direction only.
      await generateSceneVisuals(
        dir,
        parseArticleWithRecovery(articleMd("对比要点丙（已改）")).article,
        OPTS,
      );

      const jpg1b = await readFile(path.join(dir, "assets/images/scene_1.jpg"));
      const jpg2b = await readFile(path.join(dir, "assets/images/scene_2.jpg"));
      expect(jpg1b.equals(jpg1)).toBe(true); // untouched scene: cached
      expect(jpg2b.equals(jpg2)).toBe(false); // edited scene: regenerated
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("adopts legacy images without sidecars (no re-spend on upgrade)", async () => {
    const dir = await mkProject();
    try {
      // Pre-v0.8 state: image exists, no .cache.json sidecar.
      const legacy = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      await writeFile(path.join(dir, "assets/images/scene_1.jpg"), legacy);
      await generateSceneVisuals(
        dir,
        parseArticleWithRecovery(articleMd("对比要点乙")).article,
        OPTS,
      );
      const kept = await readFile(path.join(dir, "assets/images/scene_1.jpg"));
      expect(kept.equals(legacy)).toBe(true); // adopted, NOT regenerated
      const sidecar = JSON.parse(
        await readFile(
          path.join(dir, "assets/images/scene_1.cache.json"),
          "utf8",
        ),
      ) as { cacheKey: string };
      expect(sidecar.cacheKey).toMatch(/^sha256:/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("image_style flip invalidates EVERY image (style is a global input)", async () => {
    const dir = await mkProject();
    try {
      await generateSceneVisuals(
        dir,
        parseArticleWithRecovery(
          articleMd("对比要点乙", "image_style: flat-vector\n"),
        ).article,
        OPTS,
      );
      // Style participates in every scene's cache key — a flip re-seeds
      // the whole look, so every image regenerates. (Mock output is
      // prompt-deterministic; observe via generation events.)
      const labels = await generatedLabels(
        dir,
        parseArticleWithRecovery(
          articleMd("对比要点乙", "image_style: editorial\n"),
        ).article,
      );
      expect(labels).toContain("image scene_1");
      expect(labels).toContain("image scene_2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("image cache keys the expander revision", () => {
  it("a reworded brief expander invalidates every image, like a style flip", () => {
    const base = {
      sceneNumber: 1,
      visual: "对比要点乙",
      imageStyle: "flat-vector",
      provider: "mock",
      learnedDigest: "",
      bakeDigest: "",
      width: 1920,
      height: 1080,
    };
    const key = imageCacheKey({ ...base, promptRevision: "2" });
    // The brief an image was generated from is an input like any other:
    // reword the expander and every existing image is stale, because it
    // no longer corresponds to the prompt that would be sent today.
    expect(imageCacheKey({ ...base, promptRevision: "1" })).not.toBe(key);
    // Unrelated inputs stay independent.
    expect(imageCacheKey({ ...base, promptRevision: "2" })).toBe(key);
    expect(
      imageCacheKey({ ...base, visual: "对比要点丙", promptRevision: "2" }),
    ).not.toBe(key);
  });

  it("keys on the bake spec — baked text lives inside the jpg (v0.10.5)", () => {
    const base = {
      sceneNumber: 1,
      visual: "v",
      imageStyle: "editorial",
      provider: "minimax",
      learnedDigest: "",
      bakeDigest: "sha256:aaa",
      width: 1920,
      height: 1080,
      promptRevision: "6",
    };
    const key = imageCacheKey(base);
    // An edited title must invalidate the cached image: the old typography
    // is baked into the pixels, not composited at render time.
    expect(imageCacheKey({ ...base, bakeDigest: "sha256:bbb" })).not.toBe(key);
    expect(imageCacheKey({ ...base, bakeDigest: "sha256:aaa" })).toBe(key);
  });
});
