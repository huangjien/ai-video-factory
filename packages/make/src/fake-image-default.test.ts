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
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  articleToStoryboardYaml,
  parseArticle,
  type ParsedArticle,
} from "@video/draft";
import { generateSceneVisuals, resolveImageProvider } from "./index.js";

/** Offline generation never restores synthetic geometric illustrations.
 * Cached images stay bound to their scenes; missing images use the theme
 * background while narration captions remain available. */

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
  it("resolves --fake to none so it can reuse cached images offline", () => {
    expect(resolveImageProvider(true, undefined)).toBe("none");
  });

  it("defaults to minimax when the flag is omitted", () => {
    expect(resolveImageProvider(undefined, undefined)).toBe("minimax");
    expect(resolveImageProvider(false, undefined)).toBe("minimax");
  });

  it("honors an explicit provider, including under --fake", () => {
    for (const explicit of [
      "minimax",
      "minimax-h3",
      "openai",
      "gemini",
      "mock",
      "none",
    ] as const) {
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

  it("honors image_provider: minimax-h3 from the article.md frontmatter", () => {
    // `video draft --image-provider minimax-h3` stamps the frontmatter;
    // `video make` must honor it without the flag.
    expect(
      resolveImageProvider(undefined, undefined, "minimax-h3"),
    ).toBe("minimax-h3");
    expect(resolveImageProvider(false, undefined, "minimax-h3")).toBe(
      "minimax-h3",
    );
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
  return (
    (parseYaml(readFileSync(sbPath, "utf8")) as { scenes?: SceneYaml[] })
      .scenes ?? []
  );
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

  function writeStoryboardWithKenBurns(value: number): void {
    const board = parseYaml(readFileSync(sbPath, "utf8")) as {
      scenes?: SceneYaml[];
    };
    const scene = board.scenes?.[2];
    scene!.visual = {
      component: "ImageBackground",
      props: { src: "assets/images/scene_3.jpg", kenBurnsScale: value },
    };
    writeFileSync(sbPath, stringifyYaml(board), "utf8");
  }

  it("keeps image scenes and removes unavailable image paths when the provider is none", async () => {
    expect(
      await generateSceneVisuals(projectRoot, article, { provider: "none" }),
    ).toEqual([]);

    const scenes = readStoryboard(sbPath);
    expect(scenes.length).toBeGreaterThan(0);
    expect(scenes.map((s) => s.visual?.component)).toContain("ImageBackground");
    expect(scenes[1]?.visual?.props).not.toHaveProperty("src");
  });

  it("uses the generated image without adding a duplicate scene-label caption", async () => {
    const before = readStoryboard(sbPath)[2];
    expect(before?.id).toBe("scene-03");
    expect(before?.visual?.component).toBe("ImageBackground");

    await generateSceneVisuals(projectRoot, article, { provider: "mock" });

    const after = readStoryboard(sbPath)[2];
    expect(after?.visual?.component).toBe("ImageBackground");
    expect(after?.visual?.props?.["src"]).toContain("scene_3");
    expect(after?.visual?.props).not.toHaveProperty("caption");
  });

  it("carries kenBurnsScale onto ImageBackground when switched (CS-09)", async () => {
    // Same class of silent loss as the caption above: a still-first
    // channel expresses its motion in visual.props.kenBurnsScale, and
    // the switch rebuilds props from scratch. Dropping it restores
    // ImageBackground's own 0.08 default, so the shot drifts again.
    writeStoryboardWithKenBurns(0.015);
    expect(readStoryboard(sbPath)[2]?.visual?.props?.["kenBurnsScale"]).toBe(
      0.015,
    );

    await generateSceneVisuals(projectRoot, article, { provider: "mock" });

    const after = readStoryboard(sbPath)[2];
    expect(after?.visual?.component).toBe("ImageBackground");
    expect(after?.visual?.props?.["kenBurnsScale"]).toBe(0.015);
  });

  it("keeps a still frame at 0 rather than dropping the falsy value", async () => {
    // `0` is the profile's default and the common case, so a truthiness
    // check here would silently un-freeze every still shot.
    writeStoryboardWithKenBurns(0);
    expect(readStoryboard(sbPath)[2]?.visual?.props?.["kenBurnsScale"]).toBe(0);

    await generateSceneVisuals(projectRoot, article, { provider: "mock" });

    expect(readStoryboard(sbPath)[2]?.visual?.props?.["kenBurnsScale"]).toBe(0);
  });

  it("leaves the key absent when no motion prop was ever set", async () => {
    await generateSceneVisuals(projectRoot, article, { provider: "mock" });

    expect(readStoryboard(sbPath)[2]?.visual?.props).not.toHaveProperty(
      "kenBurnsScale",
    );
  });
});
