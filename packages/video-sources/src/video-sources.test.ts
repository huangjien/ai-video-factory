import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseCommonsVideoResponse,
  filterFreeVideos,
} from "./sources/commons-video.js";
import {
  MAX_VIDEO_SCENES,
  normalizeVideoPlan,
  type PlanVideoSceneInput,
} from "./plan.js";
import { resolveSceneVideo, videoQueryVariants } from "./retrieve.js";
import {
  readVideoPlanCache,
  videoPlanCacheKey,
  writeVideoPlanCache,
} from "./plan-cache.js";
import {
  readAllSceneVideoSources,
  writeSceneVideoSource,
  writeVideoAttributionFile,
  type SceneVideoRecord,
} from "./attribution.js";
import type { VideoCandidate, SceneVideoResolution } from "./types.js";

const candidate = (over: Partial<VideoCandidate> = {}): VideoCandidate => ({
  source: "commons-video",
  title: "Carrier landing 1944.ogv",
  pageUrl: "https://commons.wikimedia.org/wiki/File:Carrier_landing_1944.ogv",
  fileUrl: "https://upload.wikimedia.org/wikipedia/commons/x/xx/landing.ogv",
  author: "US Navy",
  license: "PD",
  licenseUrl: "",
  width: 640,
  height: 480,
  durationSec: 120,
  sizeBytes: 10_000_000,
  digestKey: "https://upload.wikimedia.org/wikipedia/commons/x/xx/landing.ogv|PD",
  query: "carrier landing",
  ...over,
});

describe("parseCommonsVideoResponse — the licence gate lives in the file record", () => {
  const page = (over: Record<string, unknown>) => ({
    title: "File:Test.ogv",
    imageinfo: [
      {
        url: "https://upload.wikimedia.org/wikipedia/commons/x/xx/test.ogv",
        descriptionurl: "https://commons.wikimedia.org/wiki/File:Test.ogv",
        size: 1000,
        duration: 30,
        mediatype: "VIDEO",
        extmetadata: {
          License: { value: "Public domain" },
          Artist: { value: "<span>US Navy</span>" },
        },
        ...over,
      },
    ],
  });

  it("parses a free VIDEO file into a candidate", () => {
    const out = parseCommonsVideoResponse(
      { query: { pages: [page({})] } },
      "test",
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.license).toBe("PD");
    expect(out[0]?.durationSec).toBe(30);
    expect(out[0]?.author).toBe("US Navy");
    expect(out[0]?.sizeBytes).toBe(1000);
  });

  it("rejects a Wikimedia Copyrighted:true flag even with a free-looking licence", () => {
    const json = {
      query: {
        pages: [
          page({
            extmetadata: {
              License: { value: "Public domain" },
              Copyrighted: { value: "true" },
            },
          }),
        ],
      },
    };
    expect(parseCommonsVideoResponse(json, "test")).toHaveLength(0);
  });

  it("rejects a non-VIDEO mediatype and an oversized file", () => {
    const json = {
      query: {
        pages: [
          page({ mediatype: "IMAGE" }),
          page({ size: 250 * 1024 * 1024 }),
        ],
      },
    };
    expect(parseCommonsVideoResponse(json, "test")).toHaveLength(0);
  });

  it("parses a malformed response to an empty list, not a throw", () => {
    expect(parseCommonsVideoResponse({ nonsense: true }, "t")).toEqual([]);
    expect(parseCommonsVideoResponse("nope", "t")).toEqual([]);
  });
});

describe("filterFreeVideos — PD/CC0/PDM only", () => {
  it("drops CC-BY and unknown licences", () => {
    const out = filterFreeVideos([
      candidate({ license: "PD" }),
      candidate({ license: "CC-BY-4.0", fileUrl: "https://a" }),
      candidate({ license: "SomeOtherThing", fileUrl: "https://b" }),
      candidate({ license: "CC0", fileUrl: "https://c" }),
    ]);
    expect(out.map((c) => c.license).sort()).toEqual(["CC0", "PD"]);
  });
});

describe("resolveSceneVideo — a clip must cover the scene", () => {
  it("rejects clips shorter than the scene and clips of unknown length", () => {
    const { candidate: none } = resolveSceneVideo(
      [
        candidate({ durationSec: 5, fileUrl: "https://short" }),
        candidate({ durationSec: null, fileUrl: "https://unknown" }),
      ],
      "carrier landing",
      10,
    );
    expect(none).toBeNull();
  });

  it("accepts a clip within tolerance of the scene length", () => {
    const { candidate: got } = resolveSceneVideo(
      [candidate({ durationSec: 9.9 })],
      "carrier landing",
      10,
    );
    expect(got).not.toBeNull();
  });

  it("picks the best title match among covering clips", () => {
    const { candidate: got } = resolveSceneVideo(
      [
        candidate({ title: "Unrelated parade 1951", fileUrl: "https://p" }),
        candidate({ title: "Carrier landing aboard USS Yorktown 1944", fileUrl: "https://y" }),
      ],
      "carrier landing",
      10,
    );
    expect(got?.fileUrl).toBe("https://y");
  });
});

describe("normalizeVideoPlan — cap, reconcile, drop", () => {
  const scenes: PlanVideoSceneInput[] = Array.from(
    { length: 8 },
    (_, i) => ({ scene: i + 1, id: `scene-0${i + 1}`, visual: "something" }),
  );

  it("caps footage scenes at 5 and marks the rest over-cap", () => {
    const raw = scenes.map((s) => ({
      scene: s.scene,
      historical: true,
      subject: `subject ${s.scene}`,
      query: `query ${s.scene}`,
      reason: "r",
    }));
    const plan = normalizeVideoPlan(raw, { title: "t", scenes });
    const historical = plan.filter((p) => p.historical);
    expect(historical).toHaveLength(MAX_VIDEO_SCENES);
    expect(plan.find((p) => p.scene === 6)?.reason).toBe(
      "over the per-film footage cap",
    );
  });

  it("marks unplanned and query-less scenes as not historical", () => {
    const plan = normalizeVideoPlan(
      [
        { scene: 1, historical: true, subject: "x", query: "y", reason: "" },
        { scene: 2, historical: true, subject: "", query: "", reason: "" },
      ],
      { title: "t", scenes: scenes.slice(0, 3) },
    );
    expect(plan[0]?.historical).toBe(true);
    expect(plan[1]?.historical).toBe(false);
    expect(plan[2]?.reason).toBe("not planned");
  });
});

describe("videoQueryVariants — widest-first ladder", () => {
  it("tries the query, the subject, then individual terms", () => {
    expect(
      videoQueryVariants({
        scene: 1,
        historical: true,
        subject: "假想敌部队",
        query: "opfor training us army",
        reason: "",
      }),
    ).toEqual([
      "opfor training us army",
      "假想敌部队",
      "opfor",
      "training",
      "us",
    ]);
  });
});

describe("plan cache — round-trips and invalidates on key", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vf-vplan-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("writes, reads back, and rejects a different key", () => {
    const key = videoPlanCacheKey({ title: "t", scenes: [] });
    const plan = [
      { scene: 1, historical: true, subject: "s", query: "q", reason: "r" },
    ];
    writeVideoPlanCache(dir, key, plan);
    expect(readVideoPlanCache(dir, key)).toEqual(plan);
    expect(readVideoPlanCache(dir, "other-key")).toBeNull();
  });
});

describe("attribution — sidecar and ATTRIBUTION.md", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vf-vattr-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("writes a sidecar that reads back with the same fields", async () => {
    const record: SceneVideoRecord = {
      schema: "scene-video-source/1",
      source: "commons-video",
      title: "Carrier landing 1944.ogv",
      author: "US Navy",
      license: "PD",
      licenseUrl: "",
      pageUrl: "https://commons.wikimedia.org/wiki/File:Carrier_landing_1944.ogv",
      fileUrl: "https://upload.wikimedia.org/x/landing.ogv",
      localPath: "/tmp/scene_1.mp4",
      durationSec: 120,
      digest: "clip:abc",
      sha256: "def",
      retrievedAt: "2026-11-21T00:00:00.000Z",
    };
    writeSceneVideoSource(dir, 1, record);
    const all = readAllSceneVideoSources(dir);
    expect(all).toHaveLength(1);
    expect(all[0]?.scene).toBe(1);
    expect(all[0]?.record.license).toBe("PD");
  });

  it("writes a markdown attribution row per clip", async () => {
    const record: SceneVideoRecord = {
      schema: "scene-video-source/1",
      source: "commons-video",
      title: "Landing | takeoff reel",
      author: "US Navy",
      license: "PD",
      licenseUrl: "",
      pageUrl: "https://commons.wikimedia.org/wiki/File:x.ogv",
      fileUrl: "https://upload.wikimedia.org/x.ogv",
      localPath: "/tmp/scene_1.mp4",
      durationSec: 60,
      digest: "clip:abc",
      sha256: "def",
      retrievedAt: "2026-11-21T00:00:00.000Z",
    };
    const out = writeVideoAttributionFile(dir, [{ scene: 1, record }]);
    const text = await readFile(out, "utf8");
    expect(text).toContain("Video attribution");
    expect(text).toContain("Landing \\| takeoff reel");
    expect(text).toContain("[link](https://commons.wikimedia.org/wiki/File:x.ogv)");
  });
});

describe("resolution shape — the digest is stable per clip", () => {
  it("keeps the resolution contract fields", () => {
    const resolution: SceneVideoResolution = {
      scene: 1,
      candidate: candidate(),
      localPath: "/x.mp4",
      digest: "clip:abc",
      sha256: "def",
      note: "clip — Carrier landing 1944.ogv",
    };
    expect(resolution.digest.startsWith("clip:")).toBe(true);
    expect(resolution.candidate?.durationSec).toBe(120);
  });
});

describe("writeFile round-trip sanity (fixture helper)", () => {
  it("tmpdir is writable", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vf-sanity-"));
    const f = path.join(dir, "x");
    await writeFile(f, "x");
    expect(await readFile(f, "utf8")).toBe("x");
    await rm(dir, { recursive: true, force: true });
  });
});
