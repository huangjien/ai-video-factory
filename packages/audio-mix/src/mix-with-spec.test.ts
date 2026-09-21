import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mixTracksWithSpec } from "./index.js";

function wavTone(seconds: number, freq: number): Uint8Array {
  const dir = mkdtempSync(path.join(tmpdir(), "vf-mix-spec-"));
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

describe("mixTracksWithSpec (todo 2) — SFX cues + BGM fades", () => {
  let dir: string;
  let narration1: string;
  let narration2: string;
  let bgm: string;
  let sfx1: string;
  let sfx2: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vf-mix-spec-test-"));
    narration1 = path.join(dir, "scene-01.wav");
    narration2 = path.join(dir, "scene-02.wav");
    bgm = path.join(dir, "bgm.wav");
    sfx1 = path.join(dir, "whoosh.wav");
    sfx2 = path.join(dir, "ding.wav");
    writeFileSync(narration1, wavTone(2, 440));
    writeFileSync(narration2, wavTone(2, 880));
    writeFileSync(bgm, wavTone(4, 220));
    writeFileSync(sfx1, wavTone(1, 1100));
    writeFileSync(sfx2, wavTone(1, 1320));
  });

  afterAll(() => {
    try {
      execFileSync("rm", ["-rf", dir]);
    } catch {
      // ignore
    }
  });

  it("produces a mixed output longer than the longest narration", async () => {
    const out = path.join(dir, "out.wav");
    await mixTracksWithSpec({
      narrationPaths: [narration1, narration2],
      bgmPath: bgm,
      sfxCues: [
        { atSec: 2, path: sfx1 },
        { atSec: 3, path: sfx2 },
      ],
      bgmFadeInSec: 0.5,
      bgmFadeOutSec: 0.5,
      outPath: out,
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
          out,
        ],
        { encoding: "utf8" },
      ),
    );
    expect(parseFloat(probe.streams[0].duration)).toBeGreaterThanOrEqual(3.8);
  }, 120_000);

  it("throws when an SFX cue references a missing file", async () => {
    const out = path.join(dir, "out-missing.wav");
    await expect(
      mixTracksWithSpec({
        narrationPaths: [narration1],
        bgmPath: bgm,
        sfxCues: [{ atSec: 1, path: "/nonexistent.wav" }],
        outPath: out,
      }),
    ).rejects.toThrow(/sfx cue file not found/i);
  });

  it("throws when SFX cue time is negative", async () => {
    const out = path.join(dir, "out-negative.wav");
    await expect(
      mixTracksWithSpec({
        narrationPaths: [narration1],
        bgmPath: bgm,
        sfxCues: [{ atSec: -1, path: sfx1 }],
        outPath: out,
      }),
    ).rejects.toThrow(/atSec/i);
  });
});
