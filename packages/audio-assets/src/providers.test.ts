import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileBasedAudioAssetProvider, MockAudioAssetProvider } from "./index.js";

describe("MockAudioAssetProvider (todo 2)", () => {
  it("returns a placeholder BGM with metadata when no assets directory is configured", async () => {
    const p = new MockAudioAssetProvider();
    const r = await p.pickBackgroundMusic({ tag: "calm" });
    expect(r.bytes.byteLength).toBeGreaterThan(0);
    expect(r.contentType).toBe("audio/wav");
    expect(r.source).toContain("mock");
  });

  it("throws AudioAssetError when SFX tag is missing", async () => {
    const p = new MockAudioAssetProvider();
    await expect(p.pickSoundEffect({ tag: "" })).rejects.toThrow();
  });
});

describe("FileBasedAudioAssetProvider (todo 2)", () => {
  let dir: string;
  let bgmDir: string;
  let sfxDir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vf-audio-"));
    bgmDir = path.join(dir, "bgm");
    sfxDir = path.join(dir, "sfx");
    mkdirSync(bgmDir, { recursive: true });
    mkdirSync(sfxDir, { recursive: true });
    writeFileSync(path.join(bgmDir, "calm.wav"), Buffer.from([0x52, 0x49, 0x46, 0x46]));
    writeFileSync(path.join(sfxDir, "whoosh.wav"), Buffer.from([0x52, 0x49, 0x46, 0x46]));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds BGM by tag in configured directory", async () => {
    const p = new FileBasedAudioAssetProvider({
      bgmDirectory: bgmDir,
      sfxDirectory: sfxDir,
    });
    const r = await p.pickBackgroundMusic({ tag: "calm" });
    expect(r.bytes.length).toBeGreaterThan(0);
    expect(r.source).toContain(bgmDir);
  });

  it("finds SFX by tag in configured directory", async () => {
    const p = new FileBasedAudioAssetProvider({
      bgmDirectory: bgmDir,
      sfxDirectory: sfxDir,
    });
    const r = await p.pickSoundEffect({ tag: "whoosh" });
    expect(r.bytes.length).toBeGreaterThan(0);
    expect(r.source).toContain(sfxDir);
  });

  it("throws when BGM tag is not found", async () => {
    const p = new FileBasedAudioAssetProvider({
      bgmDirectory: bgmDir,
      sfxDirectory: sfxDir,
    });
    await expect(p.pickBackgroundMusic({ tag: "nope" })).rejects.toThrow(/not found/i);
  });

  it("throws when SFX tag is not found", async () => {
    const p = new FileBasedAudioAssetProvider({
      bgmDirectory: bgmDir,
      sfxDirectory: sfxDir,
    });
    await expect(p.pickSoundEffect({ tag: "nope" })).rejects.toThrow(/not found/i);
  });
});
