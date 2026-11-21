import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ParsedArticle } from "@video/draft";
import {
  resolveVideoSourcesForScenes,
  resolveVideoSourcesMode,
  parseVideoSourcesMode,
  type VideoSourcesMode,
} from "./video-sources.js";
import type { SceneVideoPlan, VideoCandidate, VideoSource } from "@video/video-sources";

/** A real 6-second 4:3 clip with audio, as a data: URL — downloadClip
 *  fetches it through the same `fetch` the network path uses, so the
 *  whole download → preprocess chain runs without a network. */
function clipDataUrl(): string {
  const tmp = path.join(
    mkdtempSync(path.join(tmpdir(), "vf-vsrc-fix-")),
    "clip.mp4",
  );
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f", "lavfi", "-i", "testsrc=duration=6:size=640x480:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest",
      tmp,
    ],
    { stdio: "ignore" },
  );
  const b64 = readFileSync(tmp).toString("base64");
  return `data:video/mp4;base64,${b64}`;
}

const CLIP_URL = clipDataUrl();

const goodCandidate = (): VideoCandidate => ({
  source: "commons-video",
  title: "Carrier landing 1944.ogv",
  pageUrl: "https://commons.wikimedia.org/wiki/File:Carrier_landing_1944.ogv",
  fileUrl: CLIP_URL,
  author: "US Navy",
  license: "PD",
  licenseUrl: "",
  width: 640,
  height: 480,
  durationSec: 6,
  sizeBytes: null,
  digestKey: `${CLIP_URL}|PD`,
  query: "carrier landing",
});

/** One-source stub: every query returns the given candidates. */
function stubSource(candidates: VideoCandidate[]): VideoSource {
  return {
    name: "commons-video",
    async search() {
      return candidates;
    },
  };
}

const article = (visuals: string[]): ParsedArticle =>
  ({
    title: "Test film",
    scenes: visuals.map((visual, i) => ({
      id: `scene-0${i + 1}`,
      visual,
    })),
  }) as ParsedArticle;

const plan = (historicalScenes: number[]): SceneVideoPlan[] =>
  visualScenes(3).map((scene) => ({
    scene,
    historical: historicalScenes.includes(scene),
    subject: historicalScenes.includes(scene) ? "carrier landing" : "",
    query: historicalScenes.includes(scene) ? "carrier landing" : "",
    reason: historicalScenes.includes(scene) ? "test" : "",
  }));

function visualScenes(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

describe("resolveVideoSourcesForScenes — the make-side loop", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "vf-vsrc-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("off → nothing runs, nothing on disk", async () => {
    const out = await resolveVideoSourcesForScenes({
      projectRoot: root,
      article: article(["a", "b"]),
      provider: null,
      mode: "off" as VideoSourcesMode,
      plan: plan([1]),
      sources: [stubSource([goodCandidate()])],
    });
    expect(out.planned).toBe(false);
    expect(existsSync(path.join(root, "assets", "video"))).toBe(false);
  });

  it("downloads, preprocesses, and records a clip for the planned scene", async () => {
    const out = await resolveVideoSourcesForScenes({
      projectRoot: root,
      article: article(["a", "b", "c"]),
      provider: null,
      mode: "on" as VideoSourcesMode,
      plan: plan([1]),
      sceneDurationsSec: [3, 3, 3],
      sources: [stubSource([goodCandidate()])],
    });
    expect(out.planned).toBe(true);
    expect(out.videoScenes).toEqual([1]);
    const clip = path.join(root, "assets", "video", "scene_1.mp4");
    expect(existsSync(clip)).toBe(true);
    // The preprocess geometry: probed through the sidecar's own record.
    const sidecar = JSON.parse(
      readFileSync(path.join(root, "assets", "video", "scene_1.source.json"), "utf8"),
    ) as { schema: string; license: string; sha256: string };
    expect(sidecar.schema).toBe("scene-video-source/1");
    expect(sidecar.license).toBe("PD");
    expect(sidecar.sha256).not.toBe("");
    expect(existsSync(path.join(root, "assets", "video", "ATTRIBUTION.md"))).toBe(true);
  });

  it("a non-free licence yields no clip and the scene keeps its art", async () => {
    const ccBy = goodCandidate();
    ccBy.license = "CC-BY-4.0";
    const out = await resolveVideoSourcesForScenes({
      projectRoot: root,
      article: article(["a"]),
      provider: null,
      mode: "on" as VideoSourcesMode,
      plan: plan([1]),
      sceneDurationsSec: [3],
      sources: [stubSource([ccBy])],
    });
    expect(out.videoScenes).toEqual([]);
    expect(existsSync(path.join(root, "assets", "video", "scene_1.mp4"))).toBe(false);
    expect(out.notes.join("\n")).toMatch(/no clip found/);
  });

  it("a clip too short for the scene is rejected", async () => {
    const short = goodCandidate();
    short.durationSec = 1;
    const out = await resolveVideoSourcesForScenes({
      projectRoot: root,
      article: article(["a"]),
      provider: null,
      mode: "on" as VideoSourcesMode,
      plan: plan([1]),
      sceneDurationsSec: [3],
      sources: [stubSource([short])],
    });
    expect(out.videoScenes).toEqual([]);
  });

  it("a failed download degrades to no clip without failing", async () => {
    const broken = goodCandidate();
    // Port 9 (discard) refuses immediately — fetch throws, download fails.
    broken.fileUrl = "http://127.0.0.1:9/clip.mp4";
    const out = await resolveVideoSourcesForScenes({
      projectRoot: root,
      article: article(["a"]),
      provider: null,
      mode: "on" as VideoSourcesMode,
      plan: plan([1]),
      sceneDurationsSec: [3],
      sources: [stubSource([broken])],
    });
    expect(out.videoScenes).toEqual([]);
    expect(out.notes.join("\n")).toMatch(/download failed/);
  });
});

describe("mode resolution — off until proven", () => {
  it("defaults to off; frontmatter or the flag turns it on", () => {
    expect(resolveVideoSourcesMode(undefined, undefined)).toBe("off");
    expect(resolveVideoSourcesMode(undefined, "on")).toBe("on");
    expect(resolveVideoSourcesMode("on", "off")).toBe("on");
    expect(resolveVideoSourcesMode("off", "on")).toBe("off");
  });

  it("parses the CLI value, ignoring typos", () => {
    expect(parseVideoSourcesMode("on")).toBe("on");
    expect(parseVideoSourcesMode("OFF")).toBe("off");
    expect(parseVideoSourcesMode("maybe")).toBeUndefined();
  });
});
