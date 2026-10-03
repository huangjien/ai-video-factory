import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { syncStoryboardDurations } from "./index.js";

const execFileAsync = promisify(execFile);

/** Regression test for the sync map-key mismatch: durations were inserted
 * keyed by the verbatim WAV-filename capture ("01") but looked up via
 * String(parseInt(id)) ("1") — zero-padded scenes silently never synced. */
describe("syncStoryboardDurations — measured lengths rewrite the storyboard", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "video-sync-durations-"));
    await mkdir(path.join(dir, "assets", "audio"), { recursive: true });
    await mkdir(path.join(dir, "storyboard"), { recursive: true });

    // scene_1.wav (unpadded name) → 2s; scene_02.wav (padded name) → 5s.
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      path.join(dir, "assets", "audio", "scene_1.wav"),
    ]);
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=5",
      path.join(dir, "assets", "audio", "scene_02.wav"),
    ]);

    await writeFile(
      path.join(dir, "storyboard", "storyboard.yaml"),
      `scenes:\n  - id: scene-01\n    duration: 60\n  - id: scene-2\n    duration: 60\n`,
      "utf8",
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("matches zero-padded and unpadded ids on both sides", async () => {
    const outputs = await syncStoryboardDurations(dir);
    expect(outputs).toContain("storyboard.yaml: scene_1 duration=2.00s");
    expect(outputs).toContain("storyboard.yaml: scene_2 duration=5.00s");

    const yaml = await readFile(
      path.join(dir, "storyboard", "storyboard.yaml"),
      "utf8",
    );
    const scene1 = yaml.slice(
      yaml.indexOf("scene-01"),
      yaml.indexOf("scene-2"),
    );
    expect(scene1).toContain("duration: 2.00");
    const scene2 = yaml.slice(yaml.indexOf("scene-2"));
    expect(scene2).toContain("duration: 5.00");
  });
});

/** The draft emitter plans animations against LLM-estimated durations;
 * when TTS measures shorter, validation would hard-fail. The sync must
 * clamp overrunning entries and drop ones that start past the scene. */
describe("syncStoryboardDurations — clamps animations to the measured scene", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "video-sync-clamp-"));
    await mkdir(path.join(dir, "assets", "audio"), { recursive: true });
    await mkdir(path.join(dir, "storyboard"), { recursive: true });

    // 4s measured audio; the storyboard plans a 6s scene.
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=4",
      path.join(dir, "assets", "audio", "scene_1.wav"),
    ]);

    await writeFile(
      path.join(dir, "storyboard", "storyboard.yaml"),
      `schema_version: "0.2"
scenes:
  - id: scene-01
    duration: 6
    narration:
      text: "x"
    visual:
      component: Comparison
      props: {}
    animations:
      - id: "left-card"
        target: "__left__"
        type: move
        start: 0.1
        duration: 2.8
        easing: easeOut
      - id: "right-card"
        target: "__right__"
        type: move
        start: 3
        duration: 2.8
        easing: easeOut
      - id: "too-late"
        target: "__left__"
        type: highlight
        start: 4.5
        duration: 1
        easing: easeOut
    captions:
      source: narration
`,
      "utf8",
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("rewrites the duration, clamps the overrun, drops the impossible entry", async () => {
    const outputs = await syncStoryboardDurations(dir);
    expect(outputs).toContain("storyboard.yaml: scene_1 duration=4.00s");
    expect(
      outputs.some(
        (o) => o.includes("right-card") && o.includes("clamped 2.80→1.00s"),
      ),
    ).toBe(true);
    expect(
      outputs.some((o) => o.includes("too-late") && o.includes("dropped")),
    ).toBe(true);
    expect(outputs.some((o) => o.includes("left-card"))).toBe(false);

    const yaml = await readFile(
      path.join(dir, "storyboard", "storyboard.yaml"),
      "utf8",
    );
    const { parse } = await import("yaml");
    const doc = parse(yaml) as {
      scenes: {
        duration: number;
        animations: { id: string; start: number; duration: number }[];
      }[];
    };
    const scene = doc.scenes[0]!;
    expect(scene.duration).toBe(4);
    const byId = new Map(scene.animations.map((a) => [a.id, a]));
    expect(byId.get("left-card")?.duration).toBe(2.8);
    expect(byId.get("right-card")?.duration).toBe(1);
    expect(byId.has("too-late")).toBe(false);
  });
});
