/**
 * Regression tests for narration ordering in the mix (2026-10-16 bug:
 * "audio has nothing to do with images and subtitle"). `pickNarrations`
 * used a lexicographic `.sort()`, so with ≥10 scenes the concat order
 * became scene_1, scene_10..scene_14, scene_2… while the visual timeline
 * ran 1→N — the mixed audio no longer matched the visuals or captions.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pickNarrations } from "./mix-command.js";

const dirs: string[] = [];

/** Scaffold a fake project with the given wav names inside assets/audio. */
async function mkProjectDir(wavs: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "narr-order-"));
  dirs.push(dir);
  const audio = path.join(dir, "assets", "audio");
  await mkdir(audio, { recursive: true });
  for (const w of wavs) await writeFile(path.join(audio, w), "", "utf8");
  return dir;
}

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("pickNarrations ordering", () => {
  it("sorts 14 unpadded scene_N wavs numerically, not lexicographically", async () => {
    const names = Array.from({ length: 14 }, (_, i) => `scene_${i + 1}.wav`);
    // Reverse so directory order ≠ sorted order (readdir order is FS-defined).
    const dir = await mkProjectDir([...names].reverse());
    const picked = pickNarrations(dir).map((p) => path.basename(p));
    expect(picked).toEqual(names);
  });

  it("sorts zero-padded and hyphenated names by scene number too", async () => {
    const dir = await mkProjectDir([
      "scene-02.wav",
      "scene-10.wav",
      "scene_1.wav",
      "scene-03.wav",
    ]);
    const picked = pickNarrations(dir).map((p) => path.basename(p));
    expect(picked).toEqual([
      "scene_1.wav",
      "scene-02.wav",
      "scene-03.wav",
      "scene-10.wav",
    ]);
  });

  it("ignores non-scene wav files", async () => {
    const dir = await mkProjectDir(["scene_2.wav", "noise.wav", "scene_1.wav"]);
    const picked = pickNarrations(dir).map((p) => path.basename(p));
    expect(picked).toEqual(["scene_1.wav", "scene_2.wav"]);
  });
});
