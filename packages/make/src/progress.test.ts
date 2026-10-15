import { describe, expect, it, vi, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  runMake,
  heartbeat,
  type ProgressEvent,
  type MakeDeps,
} from "./index.js";

/**
 * video-progress/1 (v0.7.1 plan P1): `runMake` emits structured progress
 * events — step start/done in pipeline order, per-scene tts items with
 * {index, total}, heartbeats around slow single calls (fake timers),
 * nothing on dry-run. Emission is pure data; printing is the CLI's job.
 */

const ARTICLE = `---
project: progress
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

describe("runMake progress events (video-progress/1)", () => {
  const dirs: string[] = [];
  const fakeDeps: MakeDeps = {
    renderPreview: async () => ["output/preview.mp4"],
    mix: async () => ["output/final-mixed.mp4"],
  };

  // Fresh project per test: the TTS cache silently skips cached scenes,
  // so reusing a dir would suppress per-item events.
  async function freshProject(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "vf-progress-"));
    dirs.push(dir);
    await mkdir(dir, { recursive: true });
    await writeProject(dir);
    return dir;
  }

  afterAll(async () => {
    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("emits start→done for every step in pipeline order, with elapsed", async () => {
    const dir = await freshProject();
    const events: ProgressEvent[] = [];
    const report = await runMake(
      {
        projectRoot: dir,
        fake: true,
        musicProvider: "mock",
        onEvent: (e) => events.push(e),
      },
      fakeDeps,
    );
    expect(report.steps.every((s) => s.status === "ran")).toBe(true);

    const doneLabels = events
      .filter((e) => e.kind === "done")
      .map((e) => e.label);
    expect(doneLabels).toEqual([
      "sync-storyboard",
      "generate-visuals",
      "tts scene_1",
      "tts scene_2",
      "tts",
      "sync-durations",
      "captions",
      "audio-assets",
      "render-preview",
      "mix",
    ]);
    // Every step announced before it finished.
    const firstDoneIdx = events.findIndex((e) => e.kind === "done");
    expect(events.slice(0, firstDoneIdx).map((e) => e.kind)).toEqual(["start"]);
    expect(events.find((e) => e.label === "sync-storyboard")?.kind).toBe(
      "start",
    );
    for (const e of events.filter((e) => e.kind === "done")) {
      expect(e.elapsedSec).toBeTypeOf("number");
      expect(e.elapsedSec as number).toBeGreaterThanOrEqual(0);
    }
    // No failure events on the happy path.
    expect(events.some((e) => e.kind === "fail")).toBe(false);
  });

  it("emits per-scene tts items with 1-based index and total", async () => {
    const dir = await freshProject();
    const events: ProgressEvent[] = [];
    await runMake(
      {
        projectRoot: dir,
        fake: true,
        musicProvider: "mock",
        onEvent: (e) => events.push(e),
      },
      fakeDeps,
    );
    const ttsItems = events.filter(
      (e) => e.kind === "done" && e.label.startsWith("tts scene_"),
    );
    expect(ttsItems.map((e) => e.label)).toEqual([
      "tts scene_1",
      "tts scene_2",
    ]);
    expect(ttsItems.map((e) => e.index)).toEqual([1, 2]);
    expect(ttsItems.every((e) => e.total === 2)).toBe(true);
  });

  it("emits nothing on dry-run (the report still lists would-run)", async () => {
    const dir = await freshProject();
    const events: ProgressEvent[] = [];
    const report = await runMake(
      {
        projectRoot: dir,
        fake: true,
        musicProvider: "mock",
        dryRun: true,
        onEvent: (e) => events.push(e),
      },
      fakeDeps,
    );
    expect(events).toEqual([]);
    expect(report.steps.every((s) => s.status === "would-run")).toBe(true);
  });

  it("defaults to silence when no onEvent is passed (existing behavior)", async () => {
    const dir = await freshProject();
    const report = await runMake(
      { projectRoot: dir, fake: true, musicProvider: "mock" },
      fakeDeps,
    );
    expect(report.steps.every((s) => s.status === "ran")).toBe(true);
  });

  it("emits a fail event when a step throws (then stops the pipeline)", async () => {
    const dir = await freshProject();
    const events: ProgressEvent[] = [];
    const report = await runMake(
      {
        projectRoot: dir,
        fake: true,
        musicProvider: "mock",
        onEvent: (e) => events.push(e),
      },
      {
        renderPreview: async () => {
          throw new Error("remotion exploded");
        },
        mix: async () => [],
      },
    );
    const fail = events.find((e) => e.kind === "fail");
    expect(fail?.label).toBe("render-preview");
    expect(fail?.message).toBe("remotion exploded");
    // The pipeline stops at the failed step: mix never starts, and the
    // fail is the last event the run ever emits.
    expect(events[events.length - 1]).toBe(fail);
    expect(events.some((e) => e.label === "mix")).toBe(false);
    expect(report.steps.find((s) => s.name === "mix")).toBeUndefined();
  });
});

describe("heartbeat", () => {
  it("beats after afterSec then every everySec, and stops when the call settles", async () => {
    vi.useFakeTimers();
    try {
      const events: ProgressEvent[] = [];
      const emit = (e: ProgressEvent) => events.push(e);
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const run = heartbeat(
        "slow-call",
        () => gate,
        emit,
        { everySec: 0.05, afterSec: 0.1 },
      );
      await vi.advanceTimersByTimeAsync(200);
      const beatsSoFar = events.filter((e) => e.kind === "heartbeat").length;
      expect(beatsSoFar).toBeGreaterThanOrEqual(2);
      expect(events[0]?.label).toBe("slow-call");
      expect(events[0]?.elapsedSec).toBeTypeOf("number");
      release();
      await run;
      const after = events.length;
      await vi.advanceTimersByTimeAsync(500);
      // No beats after the wrapped call settled — the interval is cleared.
      expect(events.length).toBe(after);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes through the wrapped call's value and beats zero times for fast calls", async () => {
    vi.useFakeTimers();
    try {
      const events: ProgressEvent[] = [];
      const value = await heartbeat(
        "fast-call",
        async () => 42,
        (e) => events.push(e),
        { everySec: 0.05, afterSec: 0.1 },
      );
      expect(value).toBe(42);
      await vi.advanceTimersByTimeAsync(500);
      expect(events).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
