import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runMake, writeCaptionsSrt } from "./index.js";

const execFileAsync = promisify(execFile);

/** The opening beat: a scene can ask for silence BEFORE its narration.
 *  The silence is padded into the FRONT of the narration wav, so the
 *  scene's measured length covers lead-in + speech and the voice enters
 *  after the picture has settled. */
describe("runTts — the opening beat (lead_in_sec)", () => {
  let dir: string;

  const articleOf = (leadIn: string) => `---
project: lead-in
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
${leadIn}    narration: 第一场的话。
  - id: scene_2
    duration: 5
    caption: 二
    visual: 列表要点
    narration: 第二场的话。
\`\`\`
`;

  const durationOf = async (name: string): Promise<number> => {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      path.join(dir, "assets", "audio", name),
    ]);
    return Number.parseFloat(stdout.trim());
  };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vf-lead-in-"));
    await mkdir(path.join(dir, "audio-assets"), { recursive: true });
    await writeFile(
      path.join(dir, "article.md"),
      articleOf("    lead_in_sec: 1.2\n"),
      "utf8",
    );
    await writeFile(
      path.join(dir, "audio-config.yaml"),
      "voice: zh-CN-YunjianNeural\nbgm: calm\n",
      "utf8",
    );
    await runMake({ projectRoot: dir, fake: true, dryRun: false });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("pads the front of the wav with the lead-in silence", async () => {
    const withLeadIn = await durationOf("scene_1.wav");
    const without = await durationOf("scene_2.wav");
    // The fake provider emits the same-length wav for both scenes, so
    // the difference IS the lead-in.
    expect(withLeadIn - without).toBeCloseTo(1.2, 1);
  });

  it("leaves a scene without a lead-in untouched", async () => {
    const wav = await readFile(
      path.join(dir, "assets", "audio", "scene_2.wav"),
    );
    expect(wav.byteLength).toBeGreaterThan(44);
  });
});

/** CS-07: the SRT and the burned-in track must not drift apart. The
 *  burned cues start after the lead-in (the compiler offsets them), so
 *  the SRT has to start there too — otherwise the external caption file
 *  precedes the words it captions by the length of the lead-in. */
describe("writeCaptionsSrt — the lead-in offsets the cue times", () => {
  it("starts the first cue after the lead-in", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vf-lead-in-srt-"));
    try {
      await mkdir(path.join(dir, "storyboard"), { recursive: true });
      await mkdir(path.join(dir, "captions"), { recursive: true });
      await writeFile(
        path.join(dir, "storyboard", "storyboard.yaml"),
        `schema_version: "0.2"
scenes:
  - id: scene-01
    duration: 8.0
    lead_in_sec: 1.2
    captions:
      speech_sec: 6.8
      source: narration
    narration:
      text: "第一场的旁白内容,用来验证字幕起点是否被前导静音推后。"
    visual:
      component: Title
      props:
        text: "a"
`,
        "utf8",
      );
      await writeCaptionsSrt(dir, "zh-CN");
      const srt = await readFile(
        path.join(dir, "captions", "zh-CN.srt"),
        "utf8",
      );
      expect(srt).toMatch(/^1\n00:00:01,2\d\d --> /);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
