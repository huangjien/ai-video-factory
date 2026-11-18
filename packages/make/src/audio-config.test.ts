import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAudioConfig, mixOptionsFromAudioConfig } from "./index.js";

function tempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "video-audioconfig-"));
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body, "utf8");
  }
  return dir;
}

describe("loadAudioConfig", () => {
  it("reads the config", async () => {
    const dir = tempProject({
      "audio-config.yaml":
        'voice: Chinese\nbgm: "light-gravity"\nsfx:\n  scene_1: whoosh\n',
    });
    try {
      const config = await loadAudioConfig(dir);
      expect(config.voice).toBe("Chinese");
      expect(config.bgm).toBe("light-gravity");
      expect(config.sfx).toEqual({ scene_1: "whoosh" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats a MISSING file as an empty config", async () => {
    const dir = tempProject({});
    try {
      expect(await loadAudioConfig(dir)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("mixOptionsFromAudioConfig", () => {
  it("carries the fades, the attenuation and the SFX cues", async () => {
    const dir = tempProject({});
    try {
      const opts = await mixOptionsFromAudioConfig(dir, {
        bgm_fade_in_sec: 2,
        bgm_fade_out_sec: 2.5,
        bgm_attenuation_db: -21,
        sfx: { scene_1: "whoosh", scene_10: "ding" },
      });
      expect(opts.bgmFadeInSec).toBe(2);
      expect(opts.bgmFadeOutSec).toBe(2.5);
      expect(opts.bgmAttenuationDb).toBe(-21);
      expect(opts.sfx).toEqual({ scene_1: "whoosh", scene_10: "ding" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves the BGM tag against the project-local library", async () => {
    const dir = tempProject({
      "assets/audio-assets/bgm/calm.wav": "not really audio",
    });
    try {
      const opts = await mixOptionsFromAudioConfig(dir, { bgm: "calm" });
      expect(opts.bgmPath).toContain("calm.wav");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves the BGM alone when the config names none", async () => {
    const dir = tempProject({});
    try {
      const opts = await mixOptionsFromAudioConfig(dir, { bgm: null });
      expect(opts.bgmPath).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
