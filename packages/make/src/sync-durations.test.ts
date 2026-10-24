import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";

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
      component: FlowChart
      props:
        nodes: ["a", "b"]
    animations:
      - id: "node-0"
        target: "node-0"
        type: move
        start: 0.1
        duration: 2.8
        easing: easeOut
      - id: "node-1"
        target: "node-1"
        type: move
        start: 3
        duration: 2.8
        easing: easeOut
      - id: "too-late"
        target: "node-0"
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
        (o) => o.includes("node-1") && o.includes("clamped 2.80→1.00s"),
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
    expect(byId.get("node-0")?.duration).toBe(2.8);
    expect(byId.get("node-1")?.duration).toBe(1);
    expect(byId.has("too-late")).toBe(false);
  });
});

/** The opening beat: a scene can carry silence BEFORE its narration.
 *  The measured wav length then covers lead-in + speech (+ hold), so the
 *  spoken window — what the caption cues are timed against — must be the
 *  measured length minus the lead-in, or the burned text precedes the
 *  words it captions. */
describe("syncStoryboardDurations — speech window excludes the lead-in", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "video-sync-leadin-"));
    await mkdir(path.join(dir, "assets", "audio"), { recursive: true });
    await mkdir(path.join(dir, "storyboard"), { recursive: true });

    // 5s of measured audio for each scene.
    for (const name of ["scene_1.wav", "scene_2.wav"]) {
      await execFileAsync("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=5",
        path.join(dir, "assets", "audio", name),
      ]);
    }

    await writeFile(
      path.join(dir, "storyboard", "storyboard.yaml"),
      `schema_version: "0.2"
scenes:
  - id: scene-01
    duration: 60
    lead_in_sec: 1.5
    narration:
      text: "x"
    captions:
      source: narration
    visual:
      component: Title
      props:
        text: "a"
  - id: scene-02
    duration: 60
    lead_in_sec: 1.5
    hold_after_sec: 1
    narration:
      text: "y"
    captions:
      source: narration
    visual:
      component: Title
      props:
        text: "b"
`,
      "utf8",
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("writes speech_sec = measured - lead-in - hold", async () => {
    await syncStoryboardDurations(dir);
    const yaml = await readFile(
      path.join(dir, "storyboard", "storyboard.yaml"),
      "utf8",
    );
    // scene_1: 5.00 measured - 1.50 lead-in = 3.50 spoken
    const scene1 = yaml.slice(
      yaml.indexOf("scene-01"),
      yaml.indexOf("scene-02"),
    );
    expect(scene1).toContain("duration: 5.00");
    expect(scene1).toContain("speech_sec: 3.50");
    // scene_2: 5.00 - 1.50 lead-in - 1.00 hold = 2.50 spoken
    const scene2 = yaml.slice(yaml.indexOf("scene-02"));
    expect(scene2).toContain("speech_sec: 2.50");
  });
});

/** Regression (2026-10-24): the speech-window insert and the
 *  overrunning-animation drop are both collected against the ORIGINAL
 *  line numbers. Applying the inserts first shifted every later index,
 *  so the drops then deleted the wrong block — a real storyboard came
 *  out with an orphaned `source: narration` and failed to parse. Both
 *  edit kinds must land in ONE descending pass. */
describe("syncStoryboardDurations — a lead-in insert and an animation drop coexist", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "video-sync-both-"));
    await mkdir(path.join(dir, "assets", "audio"), { recursive: true });
    await mkdir(path.join(dir, "storyboard"), { recursive: true });

    for (const name of ["scene_1.wav", "scene_2.wav"]) {
      await execFileAsync("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=5",
        path.join(dir, "assets", "audio", name),
      ]);
    }

    await writeFile(
      path.join(dir, "storyboard", "storyboard.yaml"),
      `schema_version: "0.2"
scenes:
  - id: scene-01
    duration: 60
    lead_in_sec: 1.5
    narration:
      text: "x"
    captions:
      source: narration
    visual:
      component: Title
      props:
        text: "a"
  - id: scene-02
    duration: 60
    narration:
      text: "y"
    captions:
      source: narration
    visual:
      component: FlowChart
      props:
        nodes: ["a", "b"]
    animations:
      - id: "node-0"
        target: "node-0"
        type: move
        start: 40
        duration: 30
        easing: easeOut
`,
      "utf8",
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("keeps the storyboard parseable and both edits in their own scene", async () => {
    await syncStoryboardDurations(dir);
    const yaml = await readFile(
      path.join(dir, "storyboard", "storyboard.yaml"),
      "utf8",
    );
    // Still valid YAML — the bug produced a document that failed to parse.
    const parsed = parseYaml(yaml) as {
      scenes: {
        id: string;
        captions?: { source?: string; speech_sec?: number };
        animations?: unknown[];
      }[];
    };
    expect(parsed.scenes).toHaveLength(2);
    // The insert landed in scene-01 (the captions block stayed intact).
    expect(parsed.scenes[0]?.captions?.source).toBe("narration");
    expect(parsed.scenes[0]?.captions?.speech_sec).toBeCloseTo(3.5, 2);
    // The drop landed in scene-02 (its overrunning animation is gone) —
    // and scene-01 kept everything it had.
    expect(parsed.scenes[1]?.captions?.source).toBe("narration");
    expect(parsed.scenes[1]?.animations ?? []).toHaveLength(0);
    // The drop must not bleed into the scene's other blocks: the
    // observed bug removed the animations one line early, leaving a
    // stray `easing: easeOut` inside the visual props.
    const scene2 = parsed.scenes[1] as unknown as {
      visual?: { component?: string; props?: Record<string, unknown> };
    };
    expect(scene2?.visual?.props).toEqual({ nodes: ["a", "b"] });
  });
});
