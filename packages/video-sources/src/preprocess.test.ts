import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLIP_FPS, CLIP_HEIGHT, CLIP_WIDTH, preprocessClip } from "./preprocess.js";

function probe(file: string): { width: number; height: number; duration: number; hasAudio: boolean } {
  const out = execFileSync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:format=duration",
    "-of",
    "json",
    file,
  ]).toString();
  const parsed = JSON.parse(out) as {
    streams: { width: number; height: number }[];
    format: { duration: string };
  };
  const audio = execFileSync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a",
    "-show_entries",
    "stream=index",
    "-of",
    "csv=p=0",
    file,
  ])
    .toString()
    .trim();
  return {
    width: parsed.streams[0]!.width,
    height: parsed.streams[0]!.height,
    duration: parseFloat(parsed.format.duration),
    hasAudio: audio !== "",
  };
}

/** A 6-second 4:3 landscape clip WITH audio — the shape real PD
 *  archival footage arrives in (newsreel scans are exactly this). */
function makeFixture(dir: string, name: string): string {
  const file = path.join(dir, name);
  execFileSync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=duration=6:size=640x480:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=6",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    file,
  ], { stdio: "ignore" });
  return file;
}

describe("preprocessClip — archival clip to scene background", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vf-preprocess-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("cover-crops 4:3 to 1080×1920, strips audio, hits 30fps", async () => {
    const input = makeFixture(dir, "raw.mp4");
    const output = path.join(dir, "out", "scene_1.mp4");
    await preprocessClip({ input, output });
    const p = probe(output);
    expect(p.width).toBe(CLIP_WIDTH);
    expect(p.height).toBe(CLIP_HEIGHT);
    expect(p.hasAudio).toBe(false);
    // fps is a stream attribute — assert via rate probe to stay honest.
    const rate = execFileSync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=r_frame_rate",
      "-of",
      "csv=p=0",
      output,
    ])
      .toString()
      .trim();
    expect(rate).toBe(`${CLIP_FPS}/1`);
  });

  it("trims to the scene duration when given one", async () => {
    const input = makeFixture(dir, "raw.mp4");
    const output = path.join(dir, "scene_2.mp4");
    await preprocessClip({ input, output, durationSec: 12.5 });
    const p = probe(output);
    // Source is 6 s — a trim longer than the source clamps to 6 s;
    // use a source-longer target to prove the trim actually bites.
    expect(p.duration).toBeLessThanOrEqual(6.3);
    const output2 = path.join(dir, "scene_3.mp4");
    await preprocessClip({ input, output: output2, durationSec: 2.5 });
    const p2 = probe(output2);
    expect(p2.duration).toBeGreaterThan(2.2);
    expect(p2.duration).toBeLessThan(3);
  });
});
