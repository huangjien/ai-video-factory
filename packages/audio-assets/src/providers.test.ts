import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FileBasedAudioAssetProvider,
  MockAudioAssetProvider,
} from "./index.js";

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
    dir = mkdtempSync(path.join(tmpdir(), "video-audio-"));
    bgmDir = path.join(dir, "bgm");
    sfxDir = path.join(dir, "sfx");
    mkdirSync(bgmDir, { recursive: true });
    mkdirSync(sfxDir, { recursive: true });
    writeFileSync(
      path.join(bgmDir, "calm.wav"),
      Buffer.from([0x52, 0x49, 0x46, 0x46]),
    );
    writeFileSync(
      path.join(sfxDir, "whoosh.wav"),
      Buffer.from([0x52, 0x49, 0x46, 0x46]),
    );
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
    await expect(p.pickBackgroundMusic({ tag: "nope" })).rejects.toThrow(
      /not found/i,
    );
  });

  it("throws when SFX tag is not found", async () => {
    const p = new FileBasedAudioAssetProvider({
      bgmDirectory: bgmDir,
      sfxDirectory: sfxDir,
    });
    await expect(p.pickSoundEffect({ tag: "nope" })).rejects.toThrow(
      /not found/i,
    );
  });

  // v2026-10-18 — multi-format support: the curated library at
  // assets/bgm/ now ships as mp3. The resolver must accept .mp3 with
  // the audio/mpeg MIME type so the new library can flow through the
  // existing pipeline without a conversion step.
  it("picks mp3 BGM by exact tag match", async () => {
    writeFileSync(path.join(bgmDir, "cheerful-moments-nekzlo.mp3"), Buffer.from([0xff, 0xfb]));
    const p = new FileBasedAudioAssetProvider({
      bgmDirectory: bgmDir,
      sfxDirectory: sfxDir,
    });
    const r = await p.pickBackgroundMusic({ tag: "cheerful-moments-nekzlo" });
    expect(r.contentType).toBe("audio/mpeg");
    expect(r.source).toContain("cheerful-moments-nekzlo.mp3");
  });

  it("picks m4a BGM when no .wav/.mp3 exists", async () => {
    writeFileSync(path.join(bgmDir, "ambient-take-your-pick.m4a"), Buffer.from([0, 0, 0, 0]));
    const p = new FileBasedAudioAssetProvider({
      bgmDirectory: bgmDir,
      sfxDirectory: sfxDir,
    });
    const r = await p.pickBackgroundMusic({ tag: "ambient-take-your-pick" });
    expect(r.contentType).toBe("audio/mp4");
    expect(r.source).toContain("ambient-take-your-pick.m4a");
  });

  it("prefers wav over mp3 when both exist for one tag", async () => {
    writeFileSync(path.join(bgmDir, "calm.wav"), Buffer.from([0x52, 0x49]));
    writeFileSync(path.join(bgmDir, "calm.mp3"), Buffer.from([0xff, 0xfb]));
    const p = new FileBasedAudioAssetProvider({
      bgmDirectory: bgmDir,
      sfxDirectory: sfxDir,
    });
    const r = await p.pickBackgroundMusic({ tag: "calm" });
    expect(r.source.endsWith("calm.wav")).toBe(true);
    expect(r.contentType).toBe("audio/wav");
  });

  it("falls back to substring match when no exact filename matches", async () => {
    // Uses an isolated tag (`emotional-foo`) so the m4a test above does
    // not leave behind a competing file with the same stem.
    writeFileSync(path.join(bgmDir, "emotional-foo.mp3"), Buffer.from([0xff]));
    const p = new FileBasedAudioAssetProvider({
      bgmDirectory: bgmDir,
      sfxDirectory: sfxDir,
    });
    const r = await p.pickBackgroundMusic({ tag: "emotional" });
    expect(r.source).toContain("emotional-foo.mp3");
  });
});
