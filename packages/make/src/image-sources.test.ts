import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArticleWithRecovery } from "@video/draft";
import { ArtifactPictureSource } from "@video/image-sources";
import type { ImageProvider } from "@video/media-generators";
import { generateSceneVisuals, generateWithChain } from "./index.js";
import { parseImageSourcesMode, resolveImageSourcesMode } from "./image-sources.js";

/**
 * Historical-picture retrieval, at the make level.
 *
 * The picture used here is the project's OWN (a file in assets/figures),
 * so the test needs no network and no API key — the retrieval path is
 * the same one a Wikimedia picture takes, minus the download.
 */

/** A tiny but real JPEG — the normalizer passes JPEG bytes through. */
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

function articleMd(): string {
  return `---
project: historical-sources
language: zh-CN
duration_target_sec: 12
voice: zh-CN-YunjianNeural
---

# 标题

## 1. 第一节

正文。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 5
    caption: 一
    visual: 列表要点甲
    narration: 第一句。
  - id: scene_2
    duration: 5
    caption: 二
    visual: 唐太宗肖像，古画风格
    narration: 第二句。
\`\`\`
`;
}

async function mkProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "historical-sources-"));
  await mkdir(path.join(dir, "assets", "images"), { recursive: true });
  await mkdir(path.join(dir, "assets", "figures"), { recursive: true });
  return dir;
}

const PLAN = [
  {
    scene: 1,
    historical: false,
    subject: "",
    query: "",
    mode: "none" as const,
    reason: "a list, not a person",
  },
  {
    scene: 2,
    historical: true,
    subject: "唐太宗",
    query: "唐太宗 portrait",
    mode: "direct" as const,
    reason: "a named emperor",
  },
];

describe("resolveImageSourcesMode", () => {
  it("defaults to auto and lets the flag win", () => {
    expect(resolveImageSourcesMode(undefined, undefined)).toBe("auto");
    expect(resolveImageSourcesMode("off", undefined)).toBe("off");
    expect(resolveImageSourcesMode(undefined, "off")).toBe("off");
    expect(resolveImageSourcesMode(undefined, "false")).toBe("off");
    // A typo in hand-edited frontmatter must not brick the run.
    expect(resolveImageSourcesMode(undefined, "onn")).toBe("auto");
  });

  it("parses the CLI value and ignores an unknown one", () => {
    expect(parseImageSourcesMode("auto")).toBe("auto");
    expect(parseImageSourcesMode("off")).toBe("off");
    expect(parseImageSourcesMode("nonsense")).toBeUndefined();
    expect(parseImageSourcesMode(undefined)).toBeUndefined();
  });
});

describe("the picture becomes the frame (direct mode)", () => {
  it("writes the borrowed picture as the scene image and records it", async () => {
    const dir = await mkProject();
    try {
      await writeFile(path.join(dir, "assets", "figures", "tang.jpg"), JPEG);
      const outputs = await generateSceneVisuals(
        dir,
        parseArticleWithRecovery(articleMd()).article,
        {
          provider: "mock",
          sourcePlan: PLAN,
          pictureSources: [
            new ArtifactPictureSource({ projectRoot: dir, workspaceRoot: null }),
          ],
        },
      );
      const log = outputs.join("\n");
      // The run log says where the picture came from.
      expect(log).toContain("scene_2.jpg");
      expect(log).toContain("artifact");

      // The frame IS the borrowed picture.
      const written = await readFile(
        path.join(dir, "assets", "images", "scene_2.jpg"),
      );
      expect(written.equals(JPEG)).toBe(true);

      // The machine-readable sidecar and the human-readable file.
      const record = JSON.parse(
        await readFile(
          path.join(dir, "assets", "images", "scene_2.source.json"),
          "utf8",
        ),
      ) as { license: string; mode: string; digest: string };
      expect(record.license).toBe("OWNED");
      expect(record.mode).toBe("direct");
      expect(record.digest).toMatch(/^direct:/);

      const attribution = await readFile(
        path.join(dir, "assets", "images", "ATTRIBUTION.md"),
        "utf8",
      );
      expect(attribution).toContain("tang");
      expect(attribution).toContain("frame");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the borrowed picture across a re-run — the key includes it", async () => {
    const dir = await mkProject();
    try {
      await writeFile(path.join(dir, "assets", "figures", "tang.jpg"), JPEG);
      const article = parseArticleWithRecovery(articleMd()).article;
      const opts = {
        provider: "mock" as const,
        sourcePlan: PLAN,
        pictureSources: [
          new ArtifactPictureSource({ projectRoot: dir, workspaceRoot: null }),
        ],
      };
      await generateSceneVisuals(dir, article, opts);
      const first = await readFile(
        path.join(dir, "assets", "images", "scene_2.jpg"),
      );

      const labels: string[] = [];
      await generateSceneVisuals(dir, article, {
        ...opts,
        onEvent: (e) => {
          if (e.kind === "start") labels.push(e.label);
        },
      });
      // Nothing was regenerated: the picture is part of the cache key, so
      // the same picture means the same key.
      expect(labels).not.toContain("image scene_2");
      const second = await readFile(
        path.join(dir, "assets", "images", "scene_2.jpg"),
      );
      expect(second.equals(first)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves the scene alone when the plan says nothing", async () => {
    const dir = await mkProject();
    try {
      await writeFile(path.join(dir, "assets", "figures", "tang.jpg"), JPEG);
      await generateSceneVisuals(
        dir,
        parseArticleWithRecovery(articleMd()).article,
        {
          provider: "mock",
          sourcePlan: PLAN.map((p) => ({ ...p, mode: "none" as const })),
          pictureSources: [
            new ArtifactPictureSource({ projectRoot: dir, workspaceRoot: null }),
          ],
        },
      );
      expect(
        existsSync(path.join(dir, "assets", "images", "scene_2.source.json")),
      ).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("generateWithChain and reference images", () => {
  const plain: ImageProvider = {
    name: "plain",
    generate: async () => ({ bytes: new Uint8Array([1]), contentType: "image/png" }),
  };
  const editor: ImageProvider = {
    name: "editor",
    supportsReferences: true,
    generate: async () => ({
      bytes: new Uint8Array([2]),
      contentType: "image/png",
    }),
  };

  it("skips a provider that cannot take a reference", async () => {
    // The plain provider would silently ignore the picture and draw the
    // scene from the text alone — so it is skipped, not tried.
    const r = await generateWithChain(
      [
        { name: "plain", provider: plain },
        { name: "editor", provider: editor },
      ],
      {
        prompt: "p",
        width: 1920,
        height: 1080,
        referenceImages: [{ base64: "AAA", contentType: "image/jpeg" }],
      },
    );
    expect(r.servedBy).toBe("editor");
  });

  it("fails loudly when NO provider can take the reference", async () => {
    await expect(
      generateWithChain([{ name: "plain", provider: plain }], {
        prompt: "p",
        width: 1920,
        height: 1080,
        referenceImages: [{ base64: "AAA", contentType: "image/jpeg" }],
      }),
    ).rejects.toThrow(/reference-capable/);
  });

  it("uses the whole chain when no reference is attached", async () => {
    const r = await generateWithChain(
      [
        { name: "plain", provider: plain },
        { name: "editor", provider: editor },
      ],
      { prompt: "p", width: 1920, height: 1080 },
    );
    expect(r.servedBy).toBe("plain");
  });
});
