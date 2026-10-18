import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  curatedBgmDirectory,
  listMoods,
  loadLocalBgmLibrary,
  pickByMood,
  resolveBgmTag,
} from "./index.js";

describe("local-library", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "video-bgm-lib-"));
    // 4 sample tracks covering multiple moods and two formats.
    writeFileSync(path.join(dir, "ambient-take-your-pick.mp3"), Buffer.from([0xff]));
    writeFileSync(path.join(dir, "ambient-take-your-pick.license.txt"), "Source: ...\n");
    writeFileSync(path.join(dir, "rock-not-the-only-one.mp3"), Buffer.from([0xff]));
    writeFileSync(path.join(dir, "kids-twinkle-twinkle.mp3"), Buffer.from([0xff]));
    writeFileSync(path.join(dir, "calm.wav"), Buffer.from([0x52, 0x49]));
    writeFileSync(path.join(dir, "ignored.txt"), "not audio");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("curatedBgmDirectory points at <repoRoot>/assets/bgm/", () => {
    expect(curatedBgmDirectory("/some/repo")).toBe(
      path.join("/some/repo", "assets", "bgm"),
    );
  });

  it("loadLocalBgmLibrary ignores non-audio files", () => {
    const entries = loadLocalBgmLibrary(dir);
    expect(entries).toHaveLength(4);
    // License file is part of the ambient entry's pair but should not
    // produce a second entry — the loader treats anything sharing a
    // tag as the same audio.
    const tags = entries.map((e) => e.tag).sort();
    expect(tags).toEqual([
      "ambient-take-your-pick",
      "calm",
      "kids-twinkle-twinkle",
      "rock-not-the-only-one",
    ]);
  });

  it("entries expose the mood inferred from the tag prefix", () => {
    const entries = loadLocalBgmLibrary(dir);
    const ambient = entries.find((e) => e.tag === "ambient-take-your-pick");
    expect(ambient?.mood).toBe("ambient");
    const calm = entries.find((e) => e.tag === "calm");
    expect(calm?.mood).toBe("uncategorized");
  });

  it("returns an empty list for a missing directory", () => {
    expect(loadLocalBgmLibrary(path.join(dir, "nope"))).toEqual([]);
  });

  it("listMoods deduplicates and sorts the mood labels", () => {
    const entries = loadLocalBgmLibrary(dir);
    expect(listMoods(entries)).toEqual([
      "ambient",
      "kids",
      "rock",
      "uncategorized",
    ]);
  });

  it("pickByMood returns the first tag for the mood (stable order)", () => {
    const entries = loadLocalBgmLibrary(dir);
    const ambient = entries.find((e) => e.mood === "ambient")!;
    expect(pickByMood(entries, "ambient")).toEqual(ambient);
    expect(pickByMood(entries, "AMBIENT").mood).toBe("ambient");
  });

  it("pickByMood throws when the mood has no matches", () => {
    const entries = loadLocalBgmLibrary(dir);
    expect(() => pickByMood(entries, "saxophone")).toThrow(
      /no local BGM tag matches mood "saxophone"/,
    );
  });

  describe("resolveBgmTag", () => {
    it("prefers the project-local override over the curated library", () => {
      const projectDir = mkdtempSync(path.join(tmpdir(), "video-resolve-proj-"));
      writeFileSync(
        path.join(projectDir, "ambient-take-your-pick.mp3"),
        Buffer.from([0x52, 0x49]),
      );
      const r = resolveBgmTag({
        tag: "ambient-take-your-pick",
        projectDir,
        curatedDir: dir,
      });
      expect(r.source).toBe("project");
      expect(r.path).toContain(projectDir);
      rmSync(projectDir, { recursive: true, force: true });
    });

    it("falls back to the curated library when the project has no override", () => {
      const projectDir = mkdtempSync(path.join(tmpdir(), "video-resolve-empty-"));
      const r = resolveBgmTag({
        tag: "calm",
        projectDir,
        curatedDir: dir,
      });
      expect(r.source).toBe("curated");
      expect(r.path).toContain(dir);
      rmSync(projectDir, { recursive: true, force: true });
    });

    it("picks wav over mp3 in the same directory when both exist", () => {
      const multi = mkdtempSync(path.join(tmpdir(), "video-resolve-multi-"));
      writeFileSync(path.join(multi, "calm.wav"), Buffer.from([0x52]));
      writeFileSync(path.join(multi, "calm.mp3"), Buffer.from([0xff]));
      const r = resolveBgmTag({ tag: "calm", projectDir: multi });
      expect(r.path.endsWith("calm.wav")).toBe(true);
      rmSync(multi, { recursive: true, force: true });
    });

    it("throws when neither directory has the tag", () => {
      const empty = mkdtempSync(path.join(tmpdir(), "video-resolve-empty-"));
      expect(() =>
        resolveBgmTag({ tag: "missing-tag", projectDir: empty }),
      ).toThrow(/not found/);
      rmSync(empty, { recursive: true, force: true });
    });

    it("throws when neither directory is configured", () => {
      expect(() => resolveBgmTag({ tag: "calm" })).toThrow(/not found/);
    });

    it("rejects empty tags with a clear error", () => {
      expect(() => resolveBgmTag({ tag: "  ", projectDir: dir })).toThrow(
        /bgm tag is empty/,
      );
    });
  });
});
