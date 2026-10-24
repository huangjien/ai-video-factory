import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArticleWithRecovery } from "@video/draft";
import { extractSceneFragment, hashSceneFragment } from "@video/workflow";
import { RENDERER_REVISION } from "@video/video-renderer";
import { generateSceneVisuals } from "./index.js";
import { computeMakeImpact, formatImpact } from "./impact.js";
import { ttsCacheKey } from "./tts-cache.js";
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
  it("P1 parity: regenerated jpg bytes predict render even with an intact fragment", async () => {
    const dir = await mkProject();
    try {
      const sb = `project:\n  id: impact\n  language: zh-CN\nscenes:\n  - id: scene-01\n    visual:\n      component: ImageBackground\n      props:\n        src: assets/images/scene_1.jpg\n  - id: scene-02\n    visual:\n      component: Title\n      props: {}\n`;
      await mkdir(path.join(dir, "scenes"), { recursive: true });
      await mkdir(path.join(dir, "storyboard"), { recursive: true });
      await writeFile(
        path.join(dir, "storyboard", "storyboard.yaml"),
        sb,
        "utf8",
      );
      await writeFile(path.join(dir, "assets", "images", "scene_1.jpg"), "v1");
      await writeFile(path.join(dir, "assets", "images", "scene_2.jpg"), "v1");
      const frag = extractSceneFragment(sb, "scene-01");
      const meta = {
        sceneHash: hashSceneFragment(frag ?? ""),
        rendererRevision: RENDERER_REVISION,
        imageHash: `sha256:${createHash("sha256")
          .update("v1")
          .digest("hex")
          .slice(0, 16)}`,
      };
      await writeFile(
        path.join(dir, "scenes", "00-scene-01.mp4.json"),
        JSON.stringify(meta),
        "utf8",
      );
      const frag2 = extractSceneFragment(sb, "scene-02");
      await writeFile(
        path.join(dir, "scenes", "01-scene-02.mp4.json"),
        JSON.stringify({
          sceneHash: hashSceneFragment(frag2 ?? ""),
          rendererRevision: RENDERER_REVISION,
        }),
        "utf8",
      );

      const fresh = computeMakeImpact(dir, { imageProvider: "mock" });
      expect(fresh.scenesRender).toEqual([]);
      expect(fresh.scenesCached).toContain("scene_1");
      expect(fresh.scenesCached).toContain("scene_2");

      // regenerate the jpg in place (same path, same prompt, new bytes)
      // → the dry-run must predict render for exactly that scene
      await writeFile(path.join(dir, "assets", "images", "scene_1.jpg"), "v2");
      const impact = computeMakeImpact(dir, { imageProvider: "mock" });
      expect(impact.scenesRender).toEqual(["scene_1"]);
      expect(impact.scenesCached).toEqual(["scene_2"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

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
      expect(
        computeMakeImpact(dir, { imageProvider: "mock" }).visualsGate,
      ).toEqual({
        required: true,
        state: "missing-checkpoint",
        staleScenes: [],
      });

      // Approve the current set (write the checkpoint the way G4 will).
      const scenes: Record<string, { hash: string }> = {};
      for (const n of [1, 2]) {
        const sha = fileSha256(
          path.join(dir, "assets", "images", `scene_${n}.jpg`),
        );
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
      expect(
        computeMakeImpact(dir, { imageProvider: "mock" }).visualsGate,
      ).toEqual({ required: true, state: "ok", staleScenes: [] });

      // Tamper with one image (e.g. manual edit) → gate reports it stale.
      await writeFile(
        path.join(dir, "assets", "images", "scene_2.jpg"),
        Buffer.from("tampered"),
      );
      expect(
        computeMakeImpact(dir, { imageProvider: "mock" }).visualsGate,
      ).toEqual({ required: true, state: "stale", staleScenes: [2] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("TTS cache: dash-padded scene ids report cached, not synthesize", async () => {
    // runTts writes `${scene.id}.wav` — for a project whose ids are
    // `scene-01` that is `scene-01.wav`. The impact table used to rebuild
    // the name as `scene_01.wav` (underscore), so every scene looked
    // missing and the table claimed 26 re-syntheses that never happen.
    const dashed = ARTICLE.replace("id: scene_1", "id: scene-01").replace(
      "id: scene_2",
      "id: scene-02",
    );
    const dir = await mkProject(dashed);
    try {
      const article = parseArticleWithRecovery(dashed).article;
      await mkdir(path.join(dir, "assets", "audio"), { recursive: true });
      for (const scene of article.scenes) {
        const wav = path.join(dir, "assets", "audio", `${scene.id}.wav`);
        await writeFile(wav, Buffer.from("RIFF"));
        await writeFile(
          `${wav}.json`,
          JSON.stringify({
            cacheKey: ttsCacheKey({
              narration: scene.narration,
              voice: "zh-CN-YunjianNeural",
              pauseSec: undefined,
              providerName: "edge",
              language: "zh-CN",
              voiceboxSpeed: undefined,
              voiceboxSentencePauseSec: undefined,
              holdAfterSec: scene.hold_after_sec,
              leadInSec: scene.lead_in_sec,
            }),
          }),
          "utf8",
        );
      }
      const impact = computeMakeImpact(dir, { imageProvider: "mock" });
      expect(impact.ttsSynthesize).toEqual([]);
      expect(impact.ttsCached).toEqual(["scene-01", "scene-02"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("TTS cache: a scene with a lead-in reports cached, not resynthesize", async () => {
    // The lead-in is silence padded into the FRONT of the wav, so it is
    // part of the audio's identity. The impact table used to leave it out
    // of the key, so every scene with an opening beat was reported as a
    // re-synthesis the render never made.
    const withLeadIn = ARTICLE.replace(
      "    narration: 第一句。",
      "    narration: 第一句。\n    lead_in_sec: 1.2",
    );
    const dir = await mkProject(withLeadIn);
    try {
      const article = parseArticleWithRecovery(withLeadIn).article;
      await mkdir(path.join(dir, "assets", "audio"), { recursive: true });
      for (const scene of article.scenes) {
        const wav = path.join(dir, "assets", "audio", `${scene.id}.wav`);
        await writeFile(wav, Buffer.from("RIFF"));
        await writeFile(
          `${wav}.json`,
          JSON.stringify({
            cacheKey: ttsCacheKey({
              narration: scene.narration,
              voice: "zh-CN-YunjianNeural",
              pauseSec: undefined,
              providerName: "edge",
              language: "zh-CN",
              voiceboxSpeed: undefined,
              voiceboxSentencePauseSec: undefined,
              holdAfterSec: scene.hold_after_sec,
              leadInSec: scene.lead_in_sec,
            }),
          }),
          "utf8",
        );
      }
      const impact = computeMakeImpact(dir, { imageProvider: "mock" });
      expect(impact.ttsResynth).toEqual([]);
      expect(impact.ttsCached).toEqual(["scene_1", "scene_2"]);
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
      expect(formatImpact(impact).join("\n")).toContain(
        "storyboard drift: scene_1",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
