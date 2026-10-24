import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runMake, ttsCacheKey } from "./index.js";
import type { TtsCacheKeyInput } from "./tts-cache.js";

/** The cache key for a scene, with only the inputs a test cares about
 *  changed. Every input is stated: the formula takes them all, and a
 *  forgotten one is a cache miss, not a no-op. */
function key(overrides: Partial<TtsCacheKeyInput> = {}): string {
  return ttsCacheKey({
    narration: "n",
    voice: "v",
    pauseSec: 0.3,
    providerName: "edge",
    language: "zh-CN",
    voiceboxSpeed: undefined,
    voiceboxSentencePauseSec: undefined,
    holdAfterSec: undefined,
    leadInSec: undefined,
    ...overrides,
  });
}

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
    await writeFile(path.join(dir, "audio-config.yaml"), audioConfig, "utf8");
  };

  const wavs = async () =>
    (await readFile(path.join(dir, "assets", "audio", "scene_2.wav"))).length;

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
    const report = await runMake({
      projectRoot: dir,
      fake: true,
      dryRun: false,
    });
    const tts = report.steps.find((s) => s.name === "tts");
    // Rewriting article.md bumps its mtime, so the STEP may re-run — but
    // the per-scene cache must hold: zero WAVs re-synthesized.
    expect(tts?.outputs ?? []).toEqual([]);
  });

  it("re-synthesizes ONLY the scene whose narration changed", async () => {
    await writeInputs("第二场全新的话，和以前完全不同。");
    const report = await runMake({
      projectRoot: dir,
      fake: true,
      dryRun: false,
    });
    const tts = report.steps.find((s) => s.name === "tts");
    expect(tts?.status).toBe("ran");
    expect(tts?.outputs).toEqual(["assets/audio/scene_2.wav"]);
    expect(await wavs()).toBeGreaterThan(0);
  });

  it("re-synthesizes a legacy WAV that has no sidecar", async () => {
    await rm(path.join(dir, "assets", "audio", "scene_2.wav.json"));
    const report = await runMake({
      projectRoot: dir,
      fake: true,
      dryRun: false,
    });
    const tts = report.steps.find((s) => s.name === "tts");
    expect(tts?.outputs).toContain("assets/audio/scene_2.wav");
  });
});

describe("ttsCacheKey — provider + language namespacing", () => {
  it("pins the post-language formula (edge, zh-CN)", () => {
    // Pinned 2026-10-18 from the formula WITH language — cloned/custom
    // voice ids don't encode locale the way Edge ids do, so language
    // joined the key. This intentionally retired the pre-language pin:
    // every sidecar written before re-synthesizes once (all Edge, free).
    //
    // 2026-10-19: the provider revision joined the key too — the voicebox
    // sentence stitch and the local playback-rate stretch both changed the
    // output for identical inputs, and the key could not otherwise see
    // that. The pin moves with it.
    expect(
      key({
        narration: "第一场的话。",
        voice: "zh-CN-YunjianNeural",
        pauseSec: undefined,
      }),
    ).toBe(
      "sha256:f777874af3eceaf8fbe37d91623e95807fee37109ea04f2a3bf06a309e3b9770",
    );
  });

  it("changes the key when the provider revision moves", () => {
    const before = key({ providerName: "voicebox" });
    expect(before).not.toBe(key({ providerName: "voicebox", holdAfterSec: 0 }));
  });

  it("differs per provider for the same voice/language/narration", () => {
    const edge = key();
    const voicebox = key({ providerName: "voicebox" });
    const fake = key({ providerName: "fake" });
    // Set: dynamic membership — three providers must hash to three keys.
    expect(new Set([edge, voicebox, fake]).size).toBe(3);
  });

  it("differs per language for the same custom voice id", () => {
    // "narrator-zh" through a clone backend carries no locale in its id —
    // zh-CN and en-US articles using it must not share cached audio.
    expect(key({ voice: "cloned-voice", providerName: "voicebox" })).not.toBe(
      key({
        voice: "cloned-voice",
        providerName: "voicebox",
        language: "en-US",
      }),
    );
  });
});

describe("ttsCacheKey — the opening beat (lead-in)", () => {
  it("changes the key when a lead-in is added", () => {
    // The lead-in silence changes the WAV's bytes, so it belongs in the
    // key — otherwise a scene that gained (or lost) its opening beat
    // would keep replaying the old audio.
    const withoutLeadIn = key();
    const withLeadIn = key({ leadInSec: 1.2 });
    expect(withLeadIn).not.toBe(withoutLeadIn);
    expect(key({ leadInSec: 1.2 })).not.toBe(key({ leadInSec: 2.4 }));
  });

  it("leaves the key untouched when no lead-in is set", () => {
    // The pinned hash above is the regression guard: adding a term that
    // is always present would re-synthesize every scene in every project.
    expect(key()).toBe(key({ leadInSec: undefined }));
  });
});
