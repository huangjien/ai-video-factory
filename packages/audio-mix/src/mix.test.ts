import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mixTracks } from "./index.js";

function wavSilence(seconds: number, freq = 440): Uint8Array {
  // Generate a real WAV with a sine tone using ffmpeg so the mixer has
  // valid PCM to combine (zero-filled bytes would be silent anyway, but
  // a real waveform makes the test observable).
  const dir = mkdtempSync(path.join(tmpdir(), "vf-mix-"));
  const file = path.join(dir, `tone-${freq}.wav`);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${freq}:duration=${seconds}`,
      "-ar",
      "44100",
      "-ac",
      "1",
      file,
    ],
    { stdio: "ignore" },
  );
  const bytes = readFileSync(file);
  return new Uint8Array(bytes);
}

describe("mixTracks (todo 1) — ffmpeg amix + sidechain ducking", () => {
  let dir: string;
  let narrationPath: string;
  let bgmPath: string;
  let narration2Path: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vf-mix-test-"));
    narrationPath = path.join(dir, "narration.wav");
    bgmPath = path.join(dir, "bgm.wav");
    narration2Path = path.join(dir, "narration2.wav");
    writeFileSync(narrationPath, wavSilence(2, 440));
    writeFileSync(bgmPath, wavSilence(2, 220));
    writeFileSync(narration2Path, wavSilence(2, 880));
  });

  afterAll(() => {
    try {
      execFileSync("rm", ["-rf", dir]);
    } catch {
      // ignore
    }
  });

  it("produces a mixed output longer than either input and contains audio", async () => {
    const outPath = path.join(dir, "out.wav");
    const result = await mixTracks({
      narrationPaths: [narrationPath],
      bgmPath,
      outPath,
    });
    expect(existsSync(outPath)).toBe(true);
    expect(result.outPath).toBe(outPath);
    // Probe the output with ffprobe to assert it's a valid wav
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "a:0",
          "-show_entries",
          "stream=duration,channels,sample_rate",
          "-of",
          "json",
          outPath,
        ],
        { encoding: "utf8" },
      ),
    );
    const stream = probe.streams[0];
    expect(stream.channels).toBe(1);
    expect(parseFloat(stream.duration)).toBeGreaterThanOrEqual(1.9);
  });

  it("supports multiple narration files concatenated into the mix", async () => {
    const outPath = path.join(dir, "out-multi.wav");
    await mixTracks({
      narrationPaths: [narrationPath, narration2Path],
      bgmPath,
      outPath,
    });
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "a:0",
          "-show_entries",
          "stream=duration",
          "-of",
          "json",
          outPath,
        ],
        { encoding: "utf8" },
      ),
    );
    // narration1 + narration2 concatenated ≈ 4s
    expect(parseFloat(probe.streams[0].duration)).toBeGreaterThanOrEqual(3.8);
  });

  it("throws when narration paths list is empty", async () => {
    await expect(
      mixTracks({ narrationPaths: [], bgmPath, outPath: path.join(dir, "x.wav") }),
    ).rejects.toThrow(/at least one narration/i);
  });
});
