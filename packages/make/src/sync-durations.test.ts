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
    dir = await mkdtemp(path.join(tmpdir(), "vf-sync-durations-"));
    await mkdir(path.join(dir, "assets", "audio"), { recursive: true });
    await mkdir(path.join(dir, "storyboard"), { recursive: true });

    // scene_1.wav (unpadded name) → 2s; scene_02.wav (padded name) → 5s.
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      path.join(dir, "assets", "audio", "scene_1.wav"),
    ]);
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
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
    const scene1 = yaml.slice(yaml.indexOf("scene-01"), yaml.indexOf("scene-2"));
    expect(scene1).toContain("duration: 2.00");
    const scene2 = yaml.slice(yaml.indexOf("scene-2"));
    expect(scene2).toContain("duration: 5.00");
  });
});
