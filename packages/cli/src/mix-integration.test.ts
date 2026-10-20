import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMix } from "./mix-command.js";

function tone(
  dir: string,
  name: string,
  seconds: number,
  freq: number,
): string {
  const file = path.join(dir, name);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${freq}:duration=${seconds}`,
      file,
    ],
    { stdio: "ignore" },
  );
  return file;
}

function probeDuration(file: string): number {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=duration",
      "-of",
      "csv=p=0",
      file,
    ],
    { encoding: "utf8" },
  );
  return parseFloat(out.trim());
}

describe("CLI mix integration — runMix", () => {
  let cwd: string;
  let projectDir: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "video-mixcmd-"));
    projectDir = path.join(cwd, "projects", "demo");
    for (const sub of [
      "assets/audio",
      "assets/audio-assets/bgm",
      "assets/audio-assets/sfx",
      "audio-assets",
      "output",
      "runs",
    ]) {
      mkdirSync(path.join(projectDir, sub), { recursive: true });
    }
    writeFileSync(path.join(projectDir, "state.yaml"), "status: DRAFT\n");
    tone(projectDir, "assets/audio/scene-01.wav", 2, 440);
    tone(projectDir, "assets/audio/scene-02.wav", 2, 880);
    tone(projectDir, "assets/audio-assets/bgm/calm.wav", 4, 220);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("mixes narration + bgm into final-mixed.mp4 without mix.yaml", async () => {
    const code = await runMix({ project: "demo", cwd });
    expect(code).toBe(0);
    const out = path.join(projectDir, "output", "final-mixed.mp4");
    expect(existsSync(out)).toBe(true);
    expect(probeDuration(out)).toBeGreaterThanOrEqual(3.8);
  }, 60_000);

  it("applies SFX cues + fades from mix.yaml", async () => {
    tone(projectDir, "assets/audio-assets/sfx/whoosh.wav", 1, 1100);
    writeFileSync(
      path.join(projectDir, "audio-assets", "mix.yaml"),
      "bgm: calm\nsfx:\n  scene_2: whoosh\nbgm_fade_in_sec: 0.5\nbgm_fade_out_sec: 0.5\n",
    );
    const code = await runMix({ project: "demo", cwd });
    expect(code).toBe(0);
    const out = path.join(projectDir, "output", "final-mixed.mp4");
    expect(existsSync(out)).toBe(true);
    expect(probeDuration(out)).toBeGreaterThanOrEqual(3.8);
  }, 60_000);

  it("falls back to the directory BGM when the mix.yaml bgm names a missing file", async () => {
    // Regression: pickBgm returned explicit paths without an existence
    // check, so a spec bgm tag with no matching .wav handed ffmpeg a dead
    // path instead of falling back to the default BGM.
    writeFileSync(
      path.join(projectDir, "audio-assets", "mix.yaml"),
      "bgm: no-such-track\n",
    );
    const code = await runMix({ project: "demo", cwd });
    expect(code).toBe(0);
    const out = path.join(projectDir, "output", "final-mixed.mp4");
    expect(existsSync(out)).toBe(true);
  }, 60_000);

  it("exits 1 when the project has no narration wav files", async () => {
    rmSync(path.join(projectDir, "assets/audio"), { recursive: true });
    const code = await runMix({ project: "demo", cwd });
    expect(code).toBe(1);
  });

  it("exits 1 when the project does not exist", async () => {
    const code = await runMix({ project: "missing", cwd });
    expect(code).toBe(1);
  });

  it("exits 1 with a readable error when a mix.yaml sfx tag is missing", async () => {
    writeFileSync(
      path.join(projectDir, "audio-assets", "mix.yaml"),
      "bgm: calm\nsfx:\n  scene_1: nonexistent\n",
    );
    const code = await runMix({ project: "demo", cwd });
    expect(code).toBe(1);
  });
});

describe("CLI mix — a mis-keyed SFX cue says so (CS-15)", () => {
  let cwd: string;
  let projectDir: string;
  let warnings: string[];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "video-mixkey-"));
    projectDir = path.join(cwd, "projects", "demo");
    for (const sub of [
      "assets/audio",
      "assets/audio-assets/bgm",
      "assets/audio-assets/sfx",
      "audio-assets",
      "output",
      "runs",
    ]) {
      mkdirSync(path.join(projectDir, sub), { recursive: true });
    }
    writeFileSync(path.join(projectDir, "state.yaml"), "status: DRAFT\n");
    tone(projectDir, "assets/audio/scene-01.wav", 2, 440);
    tone(projectDir, "assets/audio/scene-02.wav", 2, 880);
    tone(projectDir, "assets/audio-assets/bgm/calm.wav", 4, 220);
    tone(projectDir, "assets/audio-assets/sfx/whoosh.wav", 1, 1100);
    warnings = [];
    warnSpy = vi.spyOn(console, "warn").mockImplementation((m: unknown) => {
      warnings.push(String(m));
    });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("fails loudly on a hyphenated cue key instead of dropping it", async () => {
    // The mix.yaml schema requires scene_N with an underscore, so a
    // hyphenated key is rejected outright rather than quietly ignored.
    writeFileSync(
      path.join(projectDir, "audio-assets", "mix.yaml"),
      "bgm: calm\nsfx:\n  scene-02: whoosh\n",
    );
    const code = await runMix({ project: "demo", cwd });
    expect(code).toBe(1);
  }, 60_000);

  it("says nothing when every cue key is well formed", async () => {
    writeFileSync(
      path.join(projectDir, "audio-assets", "mix.yaml"),
      "bgm: calm\nsfx:\n  scene_2: whoosh\n",
    );
    const code = await runMix({ project: "demo", cwd });
    expect(code).toBe(0);
    expect(warnings.join("\n")).not.toMatch(/cue key/);
  }, 60_000);
});

describe("CLI mix — --sfx carries audio-config.yaml's cues (CS-15)", () => {
  let cwd: string;
  let projectDir: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "video-mixsfx-"));
    projectDir = path.join(cwd, "projects", "demo");
    for (const sub of [
      "assets/audio",
      "assets/audio-assets/bgm",
      "assets/audio-assets/sfx",
      "output",
      "runs",
    ]) {
      mkdirSync(path.join(projectDir, sub), { recursive: true });
    }
    writeFileSync(path.join(projectDir, "state.yaml"), "status: DRAFT\n");
    tone(projectDir, "assets/audio/scene-01.wav", 2, 440);
    tone(projectDir, "assets/audio/scene-02.wav", 2, 880);
    tone(projectDir, "assets/audio-assets/bgm/calm.wav", 4, 220);
    tone(projectDir, "assets/audio-assets/sfx/whoosh.wav", 1, 1100);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("fires a cue passed with --sfx", async () => {
    // Before CS-15 the mix only ever read mix.yaml, so a cue declared in
    // audio-config.yaml was materialised as a .wav and never played.
    const code = await runMix({
      project: "demo",
      cwd,
      sfx: ["scene_2=whoosh"],
    });
    expect(code).toBe(0);
    expect(existsSync(path.join(projectDir, "output", "final-mixed.mp4"))).toBe(
      true,
    );
  });

  it("rejects a hyphenated scene key loudly", async () => {
    const code = await runMix({
      project: "demo",
      cwd,
      sfx: ["scene-02=whoosh"],
    });
    expect(code).toBe(1);
  });

  it("rejects a malformed --sfx value loudly", async () => {
    const code = await runMix({ project: "demo", cwd, sfx: ["whoosh"] });
    expect(code).toBe(1);
  });
});
