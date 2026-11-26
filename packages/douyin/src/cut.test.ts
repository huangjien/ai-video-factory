import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  VerticalCutError,
  cutVertical,
  verticalCutIsFresh,
  verticalFilter,
} from "./cut.js";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vf-douyin-cut-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A tiny landscape master with an audio track. */
async function landscapeMaster(name = "master.mp4"): Promise<string> {
  const file = path.join(root, name);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=2:size=320x180:rate=15",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      file,
    ],
    { stdio: "ignore" },
  );
  return file;
}

describe("verticalFilter", () => {
  it("keeps the whole frame in the inset mode", () => {
    const filter = verticalFilter("inset", 1080, 1920, 40);
    // The backdrop covers the canvas, the foreground is the frame fitted
    // to the width — nothing is cropped away.
    expect(filter).toContain("force_original_aspect_ratio=increase");
    expect(filter).toContain("scale=1080:-2");
    expect(filter).toContain("overlay=(W-w)/2:(H-h)/2");
    expect(filter).toContain("gblur=sigma=40");
    expect(filter).not.toContain("crop=ih*9/16");
  });

  it("centre-crops in the crop mode", () => {
    const filter = verticalFilter("crop", 1080, 1920, 40);
    expect(filter).toContain("crop=ih*9/16:ih");
    expect(filter).toContain("scale=1080:1920");
    expect(filter).not.toContain("overlay=");
  });

  it("labels its output so the caller can map it", () => {
    expect(verticalFilter("inset", 1080, 1920, 40)).toContain("[v]");
    expect(verticalFilter("crop", 1080, 1920, 40)).toContain("[v]");
  });

  it("takes the same input twice in the inset mode, so it must be a complex graph", () => {
    const filter = verticalFilter("inset", 1080, 1920, 40);
    expect(filter.split("[0:v]")).toHaveLength(3);
    expect(filter).toContain(";");
  });
});

describe("cutVertical", () => {
  it("writes a vertical file with the audio copied over", async () => {
    const source = await landscapeMaster();
    const out = path.join(root, "vertical.mp4");
    const written = await cutVertical({ source, out });
    expect(written).toBe(out);
    expect(existsSync(out)).toBe(true);
    const probe = execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height",
      "-of",
      "csv=p=0",
      out,
    ]).toString();
    expect(probe).toContain("video");
    expect(probe).toContain("1080,1920");
    expect(probe).toContain("audio");
  });

  it("refuses a missing master instead of writing an empty file", async () => {
    await expect(
      cutVertical({
        source: path.join(root, "nope.mp4"),
        out: path.join(root, "out.mp4"),
      }),
    ).rejects.toThrow(VerticalCutError);
  });

  it("reports an ffmpeg failure as its own error", async () => {
    const source = path.join(root, "not-a-video.mp4");
    await writeFile(source, "this is not an mp4", "utf8");
    await expect(
      cutVertical({ source, out: path.join(root, "out.mp4") }),
    ).rejects.toThrow(/ffmpeg failed/);
  });
});

describe("verticalCutIsFresh", () => {
  it("is false when either file is missing", async () => {
    const source = await landscapeMaster();
    expect(verticalCutIsFresh(path.join(root, "out.mp4"), source)).toBe(false);
    expect(verticalCutIsFresh(source, path.join(root, "nope.mp4"))).toBe(false);
  });

  it("is false when the cut is older than the master", async () => {
    const source = await landscapeMaster();
    const out = path.join(root, "out.mp4");
    await writeFile(out, "x", "utf8");
    const now = Date.now();
    await utimes(out, new Date(now - 60_000), new Date(now - 60_000));
    expect(verticalCutIsFresh(out, source)).toBe(false);
  });

  it("is true when the cut is newer than the master", async () => {
    const source = await landscapeMaster();
    const out = path.join(root, "out.mp4");
    await writeFile(out, "x", "utf8");
    const now = Date.now();
    await utimes(out, new Date(now + 60_000), new Date(now + 60_000));
    expect(verticalCutIsFresh(out, source)).toBe(true);
    expect(statSync(out).mtimeMs).toBeGreaterThan(statSync(source).mtimeMs);
  });
});
