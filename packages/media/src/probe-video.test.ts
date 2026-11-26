import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { probeAudioDurationOrNull, probeVideoMetaOrNull } from "./probe.js";

function makeVideo(opts: { withAudio?: boolean } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "video-probe-"));
  const file = path.join(dir, "v.mp4");
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=duration=2:size=320x180:rate=15",
  ];
  if (opts.withAudio !== false) {
    args.push("-f", "lavfi", "-i", "sine=frequency=440:duration=2");
  }
  args.push(
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    ...(opts.withAudio !== false ? ["-c:a", "aac", "-shortest"] : []),
    file,
  );
  execFileSync("ffmpeg", args, { stdio: "ignore" });
  return file;
}

function makeWav(seconds: number): string {
  const dir = mkdtempSync(path.join(tmpdir(), "video-probe-"));
  const file = path.join(dir, "a.wav");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-t",
      String(seconds),
      file,
    ],
    { stdio: "ignore" },
  );
  return file;
}

describe("probeVideoMetaOrNull", () => {
  it("reports the geometry, the duration and the audio track", async () => {
    const meta = await probeVideoMetaOrNull(makeVideo());
    expect(meta).not.toBeNull();
    expect(meta?.width).toBe(320);
    expect(meta?.height).toBe(180);
    expect(meta?.durationSec).toBeCloseTo(2, 1);
    expect(meta?.hasAudio).toBe(true);
  });

  it("says a silent video has no audio track", async () => {
    const meta = await probeVideoMetaOrNull(makeVideo({ withAudio: false }));
    expect(meta?.hasAudio).toBe(false);
    expect(meta?.width).toBe(320);
  });

  it("returns nothing for a file that is not a video", async () => {
    expect(await probeVideoMetaOrNull(makeWav(1))).toBeNull();
  });

  it("returns nothing for a file ffprobe cannot read", async () => {
    expect(await probeVideoMetaOrNull("/nonexistent/v.mp4")).toBeNull();
  });
});

describe("probeAudioDurationOrNull", () => {
  it("reports the duration of a real audio file", async () => {
    await expect(probeAudioDurationOrNull(makeWav(3))).resolves.toBeCloseTo(
      3,
      1,
    );
  });

  it("returns nothing instead of throwing when the file is unreadable", async () => {
    await expect(
      probeAudioDurationOrNull("/nonexistent.wav"),
    ).resolves.toBeNull();
  });
});
