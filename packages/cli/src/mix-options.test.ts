import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mixOptionsForProject } from "./mix-command.js";

function tempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "video-mixopts-"));
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body, "utf8");
  }
  return dir;
}

describe("mixOptionsForProject", () => {
  it("reads the BGM, the fades and the cues from audio-config.yaml", async () => {
    // The regression (2026-11-16): `video mix` ignored audio-config.yaml
    // and mixed whatever mix.yaml said — a file the pipeline does not
    // write — so the command played a DIFFERENT track with no cues.
    const dir = tempProject({
      "audio-config.yaml":
        'bgm: "light-gravity"\nbgm_fade_in_sec: 2\nbgm_fade_out_sec: 2.5\nsfx:\n  scene_1: whoosh\n  scene_10: ding\n',
      "assets/audio-assets/bgm/light-gravity.wav": "not really audio",
    });
    try {
      const opts = await mixOptionsForProject(dir, {});
      expect(opts.bgmPath).toContain("light-gravity");
      expect(opts.bgmFadeInSec).toBe(2);
      expect(opts.bgmFadeOutSec).toBe(2.5);
      expect(opts.sfx).toEqual({ scene_1: "whoosh", scene_10: "ding" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lets the flags override the config", async () => {
    const dir = tempProject({
      "audio-config.yaml":
        'bgm: "light-gravity"\nbgm_fade_in_sec: 2\nsfx:\n  scene_1: whoosh\n',
      "assets/audio-assets/bgm/light-gravity.wav": "not really audio",
      "assets/audio-assets/bgm/calm.wav": "not really audio",
    });
    try {
      const opts = await mixOptionsForProject(dir, {
        bgmPath: "calm",
        bgmFadeInSec: 0.5,
        sfx: ["scene_1=ding"],
      });
      expect(opts.bgmPath).toContain("calm");
      expect(opts.bgmFadeInSec).toBe(0.5);
      // The flag wins on the same scene; the config's other cue stays.
      expect(opts.sfx).toEqual({ scene_1: "ding" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("takes a --bgm path as a path", async () => {
    const dir = tempProject({});
    try {
      const opts = await mixOptionsForProject(dir, {
        bgmPath: "/tmp/some/track.mp3",
      });
      expect(opts.bgmPath).toBe("/tmp/some/track.mp3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("works on a project with no audio-config.yaml at all", async () => {
    const dir = tempProject({});
    try {
      const opts = await mixOptionsForProject(dir, {});
      expect(opts.bgmPath).toBeUndefined();
      expect(opts.sfx).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
