import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { MAX_TOP_UP_SEC, mp3ToWav } from "./convert.js";

const execFileAsync = promisify(execFile);

/** A silent mp3 of `seconds`, via ffmpeg — real bytes, real duration. */
async function silentMp3(seconds: number): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), "convert-test-"));
  try {
    const out = path.join(dir, "a.mp3");
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", `anullsrc=r=44100:cl=mono`,
      "-t", String(seconds), "-b:a", "64k", out,
    ]);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function wavSeconds(bytes: Uint8Array): Promise<number> {
  const dir = await mkdtemp(path.join(tmpdir(), "convert-dur-"));
  try {
    const p = path.join(dir, "o.wav");
    await writeFile(p, bytes);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", p,
    ]);
    return Number.parseFloat(stdout.trim());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("mp3ToWav — the min-duration floor must not inject silence", () => {
  it("tops up a small shortfall (the LLM underestimating)", async () => {
    const wav = await mp3ToWav(await silentMp3(10), 12);
    expect(await wavSeconds(wav)).toBeGreaterThanOrEqual(11.8);
  });

  it("ignores a stale estimate far longer than the narration", async () => {
    // The real failure: a 20s narration against a leftover 37s estimate
    // used to become 37s — 17s of dead air, silently.
    const wav = await mp3ToWav(await silentMp3(20), 37);
    expect(await wavSeconds(wav)).toBeLessThan(23);
  });

  it("never truncates a narration longer than the estimate", async () => {
    const wav = await mp3ToWav(await silentMp3(30), 10);
    expect(await wavSeconds(wav)).toBeGreaterThanOrEqual(29.5);
  });

  it("honours an explicit maxTopUpSec at the tolerance boundary", async () => {
    // 10s narration vs a 20s floor is a 10s shortfall.
    const wide = await mp3ToWav(await silentMp3(10), 20, 15);
    expect(await wavSeconds(wide)).toBeGreaterThanOrEqual(19.8);
    // The same pair under the 2s default is a stale estimate, not an
    // approximation, so nothing is injected.
    const narrow = await mp3ToWav(await silentMp3(10), 20);
    expect(await wavSeconds(narrow)).toBeLessThan(13);
  });

  it("defaults to a 2s tolerance", () => {
    expect(MAX_TOP_UP_SEC).toBe(2);
  });
});
