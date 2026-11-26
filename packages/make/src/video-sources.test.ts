import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";
import type { ParsedArticle } from "@video/draft";

/** The network and ffmpeg are the boundary under test: the download and
 *  the preprocess are stubbed, so the orchestration is what runs. */
const downloadClip = vi.hoisted(() => vi.fn());
const preprocessClip = vi.hoisted(() => vi.fn());

vi.mock("@video/video-sources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@video/video-sources")>();
  return {
    ...actual,
    downloadClip: (...a: unknown[]) =>
      (downloadClip as (...x: unknown[]) => unknown)(...a),
    preprocessClip: (...a: unknown[]) =>
      (preprocessClip as (...x: unknown[]) => unknown)(...a),
  };
});

// Dynamic import is required: the vi.mock factory above must register
// before the module under test is loaded, or the real downloader ships
// into the tests.
const {
  parseVideoSourcesMode,
  resolveVideoSourcesForScenes,
  resolveVideoSourcesMode,
} = await import("./video-sources.js");

function fakeProvider(respond: () => string): Provider {
  return {
    name: "fake",
    async chat(_req: ChatRequest): Promise<ChatResponse> {
      return { content: respond(), usage: { input: 1, output: 1 } };
    },
  };
}

function articleWith(visuals: string[]): ParsedArticle {
  return {
    title: "谁被允许下阴间",
    frontmatter: { language: "zh-CN" },
    scenes: visuals.map((visual, i) => ({
      id: `scene_${i + 1}`,
      visual,
      caption: `caption ${i + 1}`,
      narration: `narration ${i + 1}`,
    })),
  } as unknown as ParsedArticle;
}

const plan = [
  {
    scene: 1,
    historical: true,
    subject: "阎罗王",
    query: "ten kings of hell",
    reason: "a historical subject",
  },
];

const candidate = {
  source: "commons" as const,
  title: "Ten Kings of Hell.webm",
  pageUrl: "https://commons.wikimedia.org/wiki/File:Ten_Kings.webm",
  fileUrl: "https://upload.wikimedia.org/Ten_Kings.webm",
  author: "A Uploader",
  license: "PD",
  licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
  width: 640,
  height: 360,
  durationSec: 30,
  localPath: null,
  digestKey: "https://upload.wikimedia.org/Ten_Kings.webm|PD",
  query: "ten kings of hell",
};

const source = {
  name: "commons-video" as const,
  async search() {
    return [candidate];
  },
};

function projectRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "vf-video-sources-"));
}

describe("resolveVideoSourcesMode", () => {
  it("lets an explicit choice win", () => {
    expect(resolveVideoSourcesMode("off", "on")).toBe("off");
    expect(resolveVideoSourcesMode("on", "off")).toBe("on");
  });

  it("reads the frontmatter", () => {
    expect(resolveVideoSourcesMode(undefined, "off")).toBe("off");
    expect(resolveVideoSourcesMode(undefined, "on")).toBe("on");
    expect(resolveVideoSourcesMode(undefined, "true")).toBe("on");
    // No frontmatter at all means the default, which is on.
    expect(resolveVideoSourcesMode(undefined, undefined)).toBe("on");
  });

  it("turns footage retrieval off on a frontmatter value it does not know", () => {
    // The opposite of the picture layer, where a typo must not switch
    // the feature off. Worth knowing: the two layers read a missing
    // frontmatter differently.
    expect(resolveVideoSourcesMode(undefined, "onn")).toBe("off");
  });
});

describe("parseVideoSourcesMode", () => {
  it("accepts the off and on spellings", () => {
    expect(parseVideoSourcesMode("off")).toBe("off");
    expect(parseVideoSourcesMode("none")).toBe("off");
    expect(parseVideoSourcesMode("on")).toBe("on");
    expect(parseVideoSourcesMode("yes")).toBe("on");
  });

  it("ignores an unknown value", () => {
    expect(parseVideoSourcesMode("maybe")).toBeUndefined();
    expect(parseVideoSourcesMode(undefined)).toBeUndefined();
  });
});

describe("resolveVideoSourcesForScenes", () => {
  it("spends nothing when the feature is off", async () => {
    const out = await resolveVideoSourcesForScenes({
      projectRoot: projectRoot(),
      article: articleWith(["a gate"]),
      provider: fakeProvider(() => "matches: []"),
      mode: "off",
      plan,
    });
    expect(out.planned).toBe(false);
    expect(out.videoScenes).toEqual([]);
  });

  it("spends nothing without a provider and without a plan", async () => {
    const out = await resolveVideoSourcesForScenes({
      projectRoot: projectRoot(),
      article: articleWith(["a gate"]),
      provider: null,
      mode: "on",
    });
    expect(out.planned).toBe(false);
  });

  it("reports a video with no footage-worthy scene", async () => {
    const out = await resolveVideoSourcesForScenes({
      projectRoot: projectRoot(),
      article: articleWith(["a gate"]),
      provider: fakeProvider(() => "matches: []"),
      mode: "on",
      plan: [{ ...plan[0]!, historical: false }],
      sources: [source],
    });
    expect(out.planned).toBe(true);
    expect(out.videoScenes).toEqual([]);
    expect(out.notes.join("\n")).toContain("no footage-worthy scene");
  });

  it("asks the planner for a plan and writes it to the project's cache", async () => {
    const root = projectRoot();
    downloadClip.mockResolvedValue({
      rawPath: path.join(root, "raw"),
      sha256: "abc123",
    });
    preprocessClip.mockImplementation(async (opts: { output: string }) => {
      await mkdir(path.dirname(opts.output), { recursive: true });
      await writeFile(opts.output, "clip", "utf8");
    });
    const out = await resolveVideoSourcesForScenes({
      projectRoot: root,
      article: articleWith(["a gate"]),
      provider: fakeProvider(
        () => `scenes:
  - scene: 1
    historical: true
    subject: "阎罗王"
    query: "ten kings of hell"
    reason: "a historical figure"`,
      ),
      mode: "on",
      sources: [source],
    });
    expect(out.planned).toBe(true);
    expect(out.plan[0]?.query).toBe("ten kings of hell");
  });

  it("keeps a scene's art when the matcher rejects every candidate", async () => {
    const out = await resolveVideoSourcesForScenes({
      projectRoot: projectRoot(),
      article: articleWith(["a gate"]),
      provider: fakeProvider(() => "matches:\n  - scene: 1\n    pick: -1\n"),
      mode: "on",
      plan,
      sources: [source],
    });
    expect(out.videoScenes).toEqual([]);
    expect(out.resolutions.get(1)?.note).toContain("matcher rejected");
  });

  it("falls back to the search order when the matcher fails", async () => {
    const root = projectRoot();
    downloadClip.mockResolvedValue({
      rawPath: path.join(root, "raw"),
      sha256: "abc123",
    });
    preprocessClip.mockImplementation(async (opts: { output: string }) => {
      await mkdir(path.dirname(opts.output), { recursive: true });
      await writeFile(opts.output, "clip", "utf8");
    });
    const provider: Provider = {
      name: "fake",
      async chat(_req: ChatRequest): Promise<ChatResponse> {
        throw new Error("matcher is down");
      },
    };
    const out = await resolveVideoSourcesForScenes({
      projectRoot: root,
      article: articleWith(["a gate"]),
      provider,
      mode: "on",
      plan,
      sources: [source],
    });
    expect(out.notes.join("\n")).toContain("matching failed");
    // The search order stands in, so the clip still reaches the screen.
    expect(out.videoScenes).toEqual([1]);
  });

  it("drops a clip that is too short to cover the scene", async () => {
    const shortSource = {
      name: "commons-video" as const,
      async search() {
        return [{ ...candidate, durationSec: 4 }];
      },
    };
    const out = await resolveVideoSourcesForScenes({
      projectRoot: projectRoot(),
      article: articleWith(["a gate"]),
      provider: fakeProvider(() => "matches: []"),
      mode: "on",
      plan,
      sources: [shortSource],
      sceneDurationsSec: [12],
    });
    // A four-second clip cannot carry a twelve-second scene.
    expect(out.videoScenes).toEqual([]);
    expect(out.resolutions.get(1)?.note).toBeDefined();
  });

  it("puts the clip on disk and records it", async () => {
    const root = projectRoot();
    downloadClip.mockResolvedValue({
      rawPath: path.join(root, "raw"),
      sha256: "abc123",
    });
    preprocessClip.mockImplementation(async (opts: { output: string }) => {
      await mkdir(path.dirname(opts.output), { recursive: true });
      await writeFile(opts.output, "clip", "utf8");
    });
    const out = await resolveVideoSourcesForScenes({
      projectRoot: root,
      article: articleWith(["a gate"]),
      provider: fakeProvider(() => "matches:\n  - scene: 1\n    pick: 0\n"),
      mode: "on",
      plan,
      sources: [source],
      sceneDurationsSec: [12],
    });
    expect(out.videoScenes).toEqual([1]);
    const clipPath = path.join(root, "assets", "video", "scene_1.mp4");
    expect(existsSync(clipPath)).toBe(true);
    expect(out.resolutions.get(1)?.sha256).toBe("abc123");
    // The clip is trimmed to the scene's rendered length.
    expect(out.notes.join("\n")).toContain("trimmed to 12 s");
    // The credit file lands next to the clip.
    expect(
      existsSync(path.join(root, "assets", "video", "ATTRIBUTION.md")),
    ).toBe(true);
  });

  it("falls back to the generated image when the download fails", async () => {
    downloadClip.mockResolvedValue(null);
    const out = await resolveVideoSourcesForScenes({
      projectRoot: projectRoot(),
      article: articleWith(["a gate"]),
      provider: fakeProvider(() => "matches:\n  - scene: 1\n    pick: 0\n"),
      mode: "on",
      plan,
      sources: [source],
    });
    expect(out.videoScenes).toEqual([]);
    expect(out.resolutions.get(1)?.note).toContain("download failed");
  });

  it("falls back to the generated image when the preprocess fails", async () => {
    const root = projectRoot();
    downloadClip.mockResolvedValue({
      rawPath: path.join(root, "raw"),
      sha256: "abc123",
    });
    preprocessClip.mockRejectedValue(new Error("ffmpeg said no"));
    const out = await resolveVideoSourcesForScenes({
      projectRoot: root,
      article: articleWith(["a gate"]),
      provider: fakeProvider(() => "matches:\n  - scene: 1\n    pick: 0\n"),
      mode: "on",
      plan,
      sources: [source],
    });
    expect(out.videoScenes).toEqual([]);
    expect(out.notes.join("\n")).toContain("preprocess failed");
  });

  it("counts the footage scenes and the clips on disk", async () => {
    const root = projectRoot();
    downloadClip.mockResolvedValue({
      rawPath: path.join(root, "raw"),
      sha256: "abc123",
    });
    preprocessClip.mockImplementation(async (opts: { output: string }) => {
      await mkdir(path.dirname(opts.output), { recursive: true });
      await writeFile(opts.output, "clip", "utf8");
    });
    const out = await resolveVideoSourcesForScenes({
      projectRoot: root,
      article: articleWith(["a gate"]),
      provider: fakeProvider(() => "matches:\n  - scene: 1\n    pick: 0\n"),
      mode: "on",
      plan,
      sources: [source],
    });
    expect(out.notes.join("\n")).toContain(
      "1 footage scene(s) planned, 1 with a clip on disk",
    );
  });
});
