import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { probeAudioDuration } from "./probe.js";

function makeWav(seconds: number): string {
  const dir = mkdtempSync(path.join(tmpdir(), "vf-probe-"));
  const file = path.join(dir, "a.wav");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `anullsrc=r=44100:cl=mono`,
      "-t",
      String(seconds),
      file,
    ],
    { stdio: "ignore" },
  );
  return file;
}

describe("probeAudioDuration (ffprobe)", () => {
  it("reports duration of a generated 3s wav within 0.1s", async () => {
    const file = makeWav(3);
    await expect(probeAudioDuration(file)).resolves.toBeCloseTo(3, 1);
  });

  it("rejects on missing file with a readable error", async () => {
    await expect(probeAudioDuration("/nonexistent.wav")).rejects.toThrow(
      /ffprobe|nonexistent/,
    );
  });
});
