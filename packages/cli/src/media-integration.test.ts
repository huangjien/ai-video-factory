import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAudioAsset } from "./audio-asset-command.js";
import { runThumbnail } from "./thumbnail-command.js";
import { runShorts } from "./shorts-command.js";

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

describe("CLI media integration — runAudioAsset / runThumbnail / runShorts", () => {
  let cwd: string;
  let projectDir: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "vf-media-"));
    const projectId = "demo";
    mkdirSync(path.join(cwd, projectId), { recursive: true });
    projectDir = path.join(cwd, "projects", projectId);
    for (const sub of [
      "storyboard",
      "assets/audio",
      "assets/audio-assets/bgm",
      "assets/audio-assets/sfx",
      "audio-assets",
      "youtube",
      "output",
      "runs",
      "checkpoints",
    ]) {
      mkdirSync(path.join(projectDir, sub), { recursive: true });
    }
    writeFileSync(
      path.join(projectDir, "state.yaml"),
      "status: DRAFT\ncurrent_stage: init\n",
    );
    tone(cwd, "bgm.wav", 3, 220);
    tone(cwd, "whoosh.wav", 1, 1100);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  // ----- runAudioAsset -----

  it("writes bgm + sfx wav files via the mock provider", async () => {
    const code = await runAudioAsset({
      project: "demo",
      cwd,
      bgmTag: "calm",
      sfxTag: "whoosh",
    });
    expect(code).toBe(0);
    expect(
      existsSync(path.join(projectDir, "assets/audio-assets/bgm/calm.wav")),
    ).toBe(true);
    expect(
      existsSync(path.join(projectDir, "assets/audio-assets/sfx/whoosh.wav")),
    ).toBe(true);
  });

  it("writes real files via the file-based provider", async () => {
    const code = await runAudioAsset({
      project: "demo",
      cwd,
      bgmTag: "calm",
      bgmDir: cwd,
    });
    expect(code).toBe(0);
    const bytes = readFileSync(
      path.join(projectDir, "assets/audio-assets/bgm/calm.wav"),
    );
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("exits 1 when neither --bgm nor --sfx is given", async () => {
    const code = await runAudioAsset({ project: "demo", cwd });
    expect(code).toBe(1);
  });

  it("exits 1 when the project does not exist", async () => {
    const code = await runAudioAsset({ project: "missing", cwd, bgmTag: "x" });
    expect(code).toBe(1);
  });

  // ----- runThumbnail -----

  it("writes thumbnail.png with the mock provider", async () => {
    writeFileSync(
      path.join(projectDir, "youtube", "thumbnail-prompt.txt"),
      "dark tech background\n",
    );
    const code = await runThumbnail({ project: "demo", cwd });
    expect(code).toBe(0);
    const png = readFileSync(path.join(projectDir, "youtube", "thumbnail.png"));
    expect(png[0]).toBe(0x89);
    expect(png.slice(1, 4).toString()).toBe("PNG");
  });

  it("exits 1 when thumbnail-prompt.txt is missing", async () => {
    const code = await runThumbnail({ project: "demo", cwd });
    expect(code).toBe(1);
  });

  // ----- runShorts (mock provider — ffmpeg clip) -----

  it("extracts a 9:16 shorts.mp4 from final-faststart.mp4", async () => {
    tone(cwd, "final.mp4", 2, 440);
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-i",
        path.join(cwd, "final.mp4"),
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        path.join(projectDir, "output", "final-faststart.mp4"),
      ],
      { stdio: "ignore" },
    );
    const code = await runShorts({ project: "demo", cwd });
    expect(code).toBe(0);
    expect(existsSync(path.join(projectDir, "youtube", "shorts.mp4"))).toBe(
      true,
    );
  }, 60_000);

  it("exits 1 when final-faststart.mp4 is missing", async () => {
    const code = await runShorts({ project: "demo", cwd });
    expect(code).toBe(1);
  });

  it("exits 1 when the minimax provider has no thumbnail or hook", async () => {
    const code = await runShorts({
      project: "demo",
      cwd,
      providerName: "minimax",
    });
    expect(code).toBe(1);
  });
});
