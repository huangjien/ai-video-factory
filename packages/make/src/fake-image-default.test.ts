import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  articleToStoryboardYaml,
  parseArticle,
  type ParsedArticle,
} from "@video/draft";
import { generateSceneVisuals, resolveImageProvider } from "./index.js";

/**
 * Regression tests for the bug: `video make --fake` rewrote every scene's
 * `visual.component` from `AnimatedIllustration` to `ImageBackground`,
 * because the make pipeline defaulted `--fake` to imageProvider="mock"
 * and `updateStoryboardForImages` switched every scene to use the mock
 * placeholder as a full-screen background. ImageBackground shows only
 * the image (no caption), so the rendered video looked fine for scene 1
 * (Title component) and then ~9 minutes of blank frames for scenes 2+
 * — users reported "video stops showing pictures and animation at 3-4
 * minutes" (real elapsed: ~28 seconds). The fix: `--fake` resolves to
 * imageProvider="none", which skips image generation entirely and
 * leaves scenes as AnimatedIllustration (caption + animated SVG).
 *
 * `video make`, `video visuals`, and the `--dry-run` impact table all
 * resolve the provider through `resolveImageProvider` — one function, so
 * a regression here breaks every entry point at once.
 */

const FAKE_ARTICLE = `---
project: fixture
language: zh-CN
duration_target_sec: 12
voice: zh-CN-YunjianNeural
---

# Fixture

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 4
    caption: 开场
    visual: "开场视觉：缓慢推近展示主标题"
    narration: |
      旁白一
  - id: scene_2
    duration: 4
    caption: 中段
    visual: "中段视觉：对比图展示差异"
    narration: |
      旁白二
  - id: scene_3
    duration: 4
    caption: 结尾
    visual: "结尾视觉：收束全景"
    narration: |
      旁白三
\`\`\`
`;

describe("resolveImageProvider", () => {
  it("resolves --fake to none so scenes keep AnimatedIllustration", () => {
    expect(resolveImageProvider(true, undefined)).toBe("none");
  });

  it("defaults to minimax when the flag is omitted", () => {
    expect(resolveImageProvider(undefined, undefined)).toBe("minimax");
    expect(resolveImageProvider(false, undefined)).toBe("minimax");
  });

  it("honors an explicit provider, including under --fake", () => {
    for (const explicit of ["minimax", "openai", "gemini", "mock", "none"] as const) {
      expect(resolveImageProvider(undefined, explicit)).toBe(explicit);
      expect(resolveImageProvider(true, explicit)).toBe(explicit);
    }
  });

  it("falls back to the article.md frontmatter image_provider", () => {
    // `video draft --image-provider` stamps this; `video make` must
    // honor it without the flag being passed again.
    expect(resolveImageProvider(undefined, undefined, "gemini")).toBe("gemini");
    expect(resolveImageProvider(false, undefined, "mock")).toBe("mock");
  });

  it("precedence: flag > --fake > frontmatter > default", () => {
    // A hand-typed frontmatter typo must not brick the pipeline.
    expect(resolveImageProvider(undefined, undefined, "not-a-provider")).toBe(
      "minimax",
    );
    // --fake means offline even when the project names a real provider.
    expect(resolveImageProvider(true, undefined, "openai")).toBe("none");
    // An explicit flag still wins over everything.
    expect(resolveImageProvider(true, "mock", "openai")).toBe("mock");
  });
});

interface SceneYaml {
  id?: string;
  visual?: { component?: string; props?: Record<string, unknown> };
}

function readStoryboard(sbPath: string): SceneYaml[] {
  return (parseYaml(readFileSync(sbPath, "utf8")) as { scenes?: SceneYaml[] })
    .scenes ?? [];
}

describe("generateSceneVisuals — provider none leaves scenes self-rendered", () => {
  let dir: string;
  let projectRoot: string;
  let sbPath: string;
  let article: ParsedArticle;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "video-fake-image-"));
    projectRoot = path.join(dir, "projects", "fixture");
    mkdirSync(path.join(projectRoot, "storyboard"), { recursive: true });
    mkdirSync(path.join(projectRoot, "assets", "audio"), {
      recursive: true,
    });
    writeFileSync(path.join(projectRoot, "article.md"), FAKE_ARTICLE, "utf8");
    sbPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
    article = parseArticle(
      readFileSync(path.join(projectRoot, "article.md"), "utf8"),
    );
    writeFileSync(sbPath, articleToStoryboardYaml(article), "utf8");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("switches nothing when the provider is none", async () => {
    expect(
      await generateSceneVisuals(projectRoot, article, { provider: "none" }),
    ).toEqual([]);

    const scenes = readStoryboard(sbPath);
    expect(scenes.length).toBeGreaterThan(0);
    expect(scenes.map((s) => s.visual?.component)).not.toContain(
      "ImageBackground",
    );
  });

  it("carries the scene caption onto ImageBackground when switched", async () => {
    // Defense-in-depth for the v0.3.6 blank-frame bug: when images ARE
    // generated (explicit --image-provider mock, or a real provider that
    // partially succeeded), updateStoryboardForImages must move the
    // AnimatedIllustration `text` prop onto ImageBackground as `caption`
    // — otherwise the switch silently drops the on-screen text.
    // articleToStoryboardYaml zero-pads ids (`scene-03`) and scenes stay in
    // article order, so index 2 is the third scene. Only scene 3's visual
    // falls through the component classifier to AnimatedIllustration.
    const before = readStoryboard(sbPath)[2];
    expect(before?.id).toBe("scene-03");
    expect(before?.visual?.component).toBe("AnimatedIllustration");
    const text = before?.visual?.props?.["text"];
    expect(typeof text).toBe("string");

    await generateSceneVisuals(projectRoot, article, { provider: "mock" });

    const after = readStoryboard(sbPath)[2];
    expect(after?.visual?.component).toBe("ImageBackground");
    expect(after?.visual?.props?.["src"]).toContain("scene_3");
    expect(after?.visual?.props?.["caption"]).toBe(text);
  });
});