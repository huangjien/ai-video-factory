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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listAvailableBgms,
  mixProject,
  pickNarrations,
  resolveBgmByTag,
} from "./mix.js";

/** A real audio tone — the mixer hands these to ffmpeg. */
function tone(file: string, seconds: number, freq: number): void {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${freq}:duration=${seconds}`,
      file,
    ],
    { stdio: "ignore" },
  );
}

describe("make/mix — narration selection", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "vf-make-mix-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function audioDir(project: string): string {
    const dir = path.join(project, "assets", "audio");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it("throws when the audio folder holds no scene wavs", () => {
    const dir = audioDir(root);
    expect(() => pickNarrations(root)).toThrow(/no scene-N\.wav files/);
    expect(existsSync(dir)).toBe(true);
  });

  it("throws when a storyboard scene has no narration on disk", () => {
    audioDir(root);
    writeFileSync(path.join(root, "assets", "audio", "scene_1.wav"), "");
    mkdirSync(path.join(root, "storyboard"), { recursive: true });
    writeFileSync(
      path.join(root, "storyboard", "storyboard.yaml"),
      "scenes:\n  - id: scene_1\n  - id: scene_2\n",
    );
    expect(() => pickNarrations(root)).toThrow(
      /narration audio missing for scene\(s\) 2/,
    );
  });

  it("follows the scene order the storyboard declares", () => {
    audioDir(root);
    writeFileSync(path.join(root, "assets", "audio", "scene_1.wav"), "");
    writeFileSync(path.join(root, "assets", "audio", "scene_2.wav"), "");
    mkdirSync(path.join(root, "storyboard"), { recursive: true });
    writeFileSync(
      path.join(root, "storyboard", "storyboard.yaml"),
      "scenes:\n  - id: scene_2\n  - id: scene_1\n",
    );
    expect(pickNarrations(root).map((p) => path.basename(p))).toEqual([
      "scene_2.wav",
      "scene_1.wav",
    ]);
  });

  it("falls back to the directory listing when the storyboard has no scene numbers", () => {
    audioDir(root);
    writeFileSync(path.join(root, "assets", "audio", "scene_1.wav"), "");
    mkdirSync(path.join(root, "storyboard"), { recursive: true });
    writeFileSync(
      path.join(root, "storyboard", "storyboard.yaml"),
      "scenes:\n  - id: intro\n",
    );
    expect(pickNarrations(root).map((p) => path.basename(p))).toEqual([
      "scene_1.wav",
    ]);
  });

  it("falls back to the directory listing when the storyboard cannot be parsed", () => {
    audioDir(root);
    writeFileSync(path.join(root, "assets", "audio", "scene_1.wav"), "");
    mkdirSync(path.join(root, "storyboard"), { recursive: true });
    writeFileSync(
      path.join(root, "storyboard", "storyboard.yaml"),
      "scenes: [unclosed\n",
    );
    expect(pickNarrations(root).map((p) => path.basename(p))).toEqual([
      "scene_1.wav",
    ]);
  });
});

describe("make/mix — BGM libraries", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "vf-make-bgms-"));
    // The repo marker: the BGM lookup walks up to the directory that
    // owns package.json — that is where the curated library lives.
    writeFileSync(path.join(root, "package.json"), '{"name":"fixture"}');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists the project library before the curated one and dedupes by tag", () => {
    const project = path.join(root, "projects", "demo");
    const local = path.join(project, "assets", "audio-assets", "bgm");
    const curated = path.join(root, "assets", "bgm");
    mkdirSync(local, { recursive: true });
    mkdirSync(curated, { recursive: true });
    writeFileSync(path.join(local, "calm.mp3"), "");
    writeFileSync(path.join(curated, "calm.mp3"), "");
    writeFileSync(path.join(curated, "rock.mp3"), "");
    writeFileSync(path.join(curated, "notes.txt"), "");
    const tags = listAvailableBgms(project).map((e) => e.tag);
    expect(tags).toEqual(["calm", "rock"]);
  });

  it("returns an empty list when neither library exists", () => {
    expect(listAvailableBgms(path.join(root, "projects", "nothing"))).toEqual(
      [],
    );
  });

  it("resolves a BGM tag against the project library first", () => {
    const project = path.join(root, "projects", "demo");
    const local = path.join(project, "assets", "audio-assets", "bgm");
    mkdirSync(local, { recursive: true });
    writeFileSync(path.join(local, "calm.mp3"), "");
    const resolved = resolveBgmByTag(project, "calm");
    expect(resolved.source).toBe("project");
    expect(resolved.path).toContain(local);
  });
});

describe("make/mix — mixProject", () => {
  let root: string;
  let project: string;

  beforeEach(() => {
    // The project lives under a repo root (a directory with package.json)
    // so the curated BGM library is found the way a real run finds it.
    const repo = mkdtempSync(path.join(tmpdir(), "vf-make-repo-"));
    root = repo;
    writeFileSync(path.join(repo, "package.json"), '{"name":"fixture"}');
    project = path.join(repo, "projects", "demo");
    for (const sub of ["assets/audio", "assets/audio-assets/sfx"]) {
      mkdirSync(path.join(project, sub), { recursive: true });
    }
    mkdirSync(path.join(repo, "assets", "bgm"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("fails with a readable error when no BGM can be found", async () => {
    writeFileSync(path.join(project, "assets", "audio", "scene_1.wav"), "");
    const outcome = await mixProject(project);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/no BGM found/);
  });

  it("fails loudly on a mis-keyed SFX cue", async () => {
    writeFileSync(path.join(project, "assets", "audio", "scene_1.wav"), "");
    writeFileSync(path.join(root, "assets", "bgm", "calm.mp3"), "");
    const outcome = await mixProject(project, {
      sfx: { "scene-2": "whoosh" },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/sfx cue key/);
  });

  it("mixes the narration with the curated BGM and writes the run record", async () => {
    tone(path.join(project, "assets", "audio", "scene_01.wav"), 2, 440);
    tone(path.join(root, "assets", "bgm", "calm.mp3"), 4, 220);
    const outcome = await mixProject(project);
    expect(outcome.ok).toBe(true);
    expect(existsSync(path.join(project, "output", "final-mixed.mp4"))).toBe(
      true,
    );
    expect(outcome.lines.join("\n")).toContain("narration=1 files");
    // The run record lands next to the project.
    expect(existsSync(path.join(project, "runs"))).toBe(true);
  }, 60_000);
});
