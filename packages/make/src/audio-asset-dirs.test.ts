import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runAudioAssets } from "./index.js";

const execFileAsync = promisify(execFile);

/**
 * vf make --bgm-dir/--sfx-dir wire the FileBasedAudioAssetProvider into
 * the pipeline so real audio from the user's library lands in
 * assets/audio-assets/. Without the flags the mock silent placeholder is
 * written. Guards the regression where BGM ducking mixed 1s of silence
 * because every asset was a mock.
 */

describe("runAudioAssets with bgmDir/sfxDir", () => {
  let dir: string;
  let projectRoot: string;
  let bgmLib: string;
  let sfxLib: string;

  const CONFIG = {
    bgm: "calm",
    sfx: { scene_1: "whoosh", scene_20: "ding" },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vf-audio-dirs-"));
    projectRoot = path.join(dir, "projects", "fixture");
    bgmLib = path.join(dir, "bgm-lib");
    sfxLib = path.join(dir, "sfx-lib");
    mkdirSync(bgmLib, { recursive: true });
    mkdirSync(sfxLib, { recursive: true });

    // Real (non-silent) WAVs: distinct tones so we can assert byte identity.
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=2",
      path.join(bgmLib, "calm.wav"),
    ]);
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=1",
      path.join(sfxLib, "whoosh.wav"),
    ]);
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "sine=frequency=1320:duration=1",
      path.join(sfxLib, "ding.wav"),
    ]);
    writeFileSync(path.join(bgmLib, "calm.license.txt"), "MIT test fixture", "utf8");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("copies the real BGM from bgmDir (same bytes, license surfaced)", async () => {
    const outputs = await runAudioAssets(projectRoot, CONFIG, { bgmDir: bgmLib });
    const outPath = path.join(projectRoot, "assets", "audio-assets", "bgm", "calm.wav");
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath).equals(readFileSync(path.join(bgmLib, "calm.wav")))).toBe(true);
    expect(outputs.join("\n")).toContain("MIT test fixture");

    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=duration", "-of", "csv=p=0", outPath,
    ]);
    expect(parseFloat(stdout.trim())).toBeGreaterThanOrEqual(1.9);
  });

  it("copies real SFX only for the kind whose dir was given; the other stays mock", async () => {
    const root2 = path.join(dir, "projects", "fixture-sfx-only");
    await runAudioAssets(root2, CONFIG, { sfxDir: sfxLib });
    const whoosh = path.join(root2, "assets", "audio-assets", "sfx", "whoosh.wav");
    const bgm = path.join(root2, "assets", "audio-assets", "bgm", "calm.wav");
    expect(readFileSync(whoosh).equals(readFileSync(path.join(sfxLib, "whoosh.wav")))).toBe(true);
    // No bgmDir → mock placeholder: 44-byte header + 8000 samples of 0x80.
    expect(readFileSync(bgm).byteLength).toBe(8044);
  });

  it("defaults to mock placeholders when no dirs are given", async () => {
    const root3 = path.join(dir, "projects", "fixture-mock");
    await runAudioAssets(root3, CONFIG);
    expect(
      readFileSync(path.join(root3, "assets", "audio-assets", "bgm", "calm.wav")).byteLength,
    ).toBe(8044);
    expect(
      readFileSync(path.join(root3, "assets", "audio-assets", "sfx", "whoosh.wav")).byteLength,
    ).toBe(8044);
  });

  it("fails readably when the tag is missing from the given dir", async () => {
    const root4 = path.join(dir, "projects", "fixture-missing");
    await expect(
      runAudioAssets(root4, { bgm: "nonexistent" }, { bgmDir: bgmLib }),
    ).rejects.toThrow(/nonexistent/);
  });
});