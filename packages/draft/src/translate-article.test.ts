import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  TranslateArticleError,
  canonicalLanguage,
  captionsSourceFor,
  hasL10n,
  translateArticle,
} from "./translate-article.js";
import type { Provider } from "@video/llm";

const CANONICAL = `---
project: 测试项目
language: zh-CN
duration_target_sec: 60
voice: narrator-zh
image_style: editorial
---

# 测试项目

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 10
    caption: 标题场景
    visual: 深蓝会议桌上的一份提案卡片，冷白顶灯
    narration: |
      第一段的旁白内容。
  - id: scene_2
    duration: 12
    caption: 第二场景
    visual: 一本摊开的技术书，细金线串起光点
    narration: |
      第二段的旁白内容。
\`\`\`
`;

const AUDIO_CONFIG = `voice: zh-CN-YunjianNeural
bgm: calm
sfx: {}
`;

/** Fake provider: returns a canned "translation" with the visual lines
 *  MANGLED — the module must pin them back to canonical byte-for-byte. */
function fakeProvider(response: () => string): Provider {
  return { name: "fake", chat: async () => ({ content: response(), usage: { input: 1, output: 1 } }) };
}

const TRANSLATED = (visualOverride?: (v: string) => string): string => `---
project: 测试项目
language: zh-CN
duration_target_sec: 60
voice: narrator-zh
---

# Test project

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 10
    caption: Title scene
    visual: ${(visualOverride ?? ((v) => v))("深蓝会议桌上的一份提案卡片，冷白顶灯")}
    narration: |
      Narration for the first scene.
  - id: scene_2
    duration: 12
    caption: Second scene
    visual: ${(visualOverride ?? ((v) => v))("一本摊开的技术书，细金线串起光点")}
    narration: |
      Narration for the second scene.
\`\`\`
`;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vidtranslate-"));
  await writeFile(path.join(root, "article.md"), CANONICAL, "utf8");
  await writeFile(path.join(root, "audio-config.yaml"), AUDIO_CONFIG, "utf8");
  await mkdir(path.join(root, "assets", "images"), { recursive: true });
  return root;
}

describe("translateArticle", () => {
  it("creates an l10n workdir with pinned visuals, rewritten frontmatter, swapped voice, and a shared images symlink", async () => {
    const root = await makeProject();
    await writeFile(
      path.join(root, "assets", "images", "scene_1.cache.json"),
      '{"cacheKey":"sha256:sentinel"}',
      "utf8",
    );
    try {
      const res = await translateArticle({
        projectRoot: root,
        targetLang: "en-US",
        provider: fakeProvider(() => TRANSLATED()),
        voice: "en-US-ChristopherNeural",
      });
      const article = readFileSync(res.articlePath, "utf8");
      // Pinned visuals survive a hostile translation.
      expect(article).toContain("visual: 深蓝会议桌上的一份提案卡片，冷白顶灯");
      expect(article).toContain("visual: 一本摊开的技术书，细金线串起光点");
      // Frontmatter rewrite.
      expect(article).toContain("language: en-US");
      expect(article).toContain("captions_source: caption");
      expect(article).not.toContain("captions_source: narration");
      // Structure preserved.
      expect(article).toContain("id: scene_1");
      expect(article).toContain("id: scene_2");
      expect(article).toContain("Narration for the first scene.");
      // audio-config voice swapped, other lines untouched.
      const cfg = readFileSync(
        path.join(res.l10nRoot, "audio-config.yaml"),
        "utf8",
      );
      expect(cfg).toContain("voice: en-US-ChristopherNeural");
      expect(cfg).toContain("bgm: calm");
      // Images symlink resolves into the canonical store — a sentinel
      // sidecar in the shared dir is readable through the link.
      const link = path.join(res.l10nRoot, "assets", "images");
      expect(statSync(link).isDirectory()).toBe(true);
      expect(
        readFileSync(path.join(link, "scene_1.cache.json"), "utf8"),
      ).toContain("sentinel");
      // Project-root markers so resolveProjectDir / make accept the workdir.
      expect(existsSync(path.join(res.l10nRoot, "state.yaml"))).toBe(true);
      expect(hasL10n(root, "en-US")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects translating to the canonical language", async () => {
    const root = await makeProject();
    try {
      await expect(
        translateArticle({
          projectRoot: root,
          targetLang: "zh-CN",
          provider: fakeProvider(() => TRANSLATED()),
          voice: "zh-CN-YunjianNeural",
        }),
      ).rejects.toThrow(TranslateArticleError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite without --force", async () => {
    const root = await makeProject();
    try {
      const opts = {
        projectRoot: root,
        targetLang: "en-US",
        provider: fakeProvider(() => TRANSLATED()),
        voice: "en-US-ChristopherNeural",
      };
      await translateArticle(opts);
      await expect(translateArticle(opts)).rejects.toThrow(/--force/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails with violations when the translation breaks structure", async () => {
    const root = await makeProject();
    try {
      // Dropping a scene → scene-count violation, unrecoverable.
      const broken = TRANSLATED().replace(
        /  - id: scene_2[\s\S]*?\n```/,
        "```",
      );
      await expect(
        translateArticle({
          projectRoot: root,
          targetLang: "en-US",
          provider: fakeProvider(() => broken),
          voice: "en-US-ChristopherNeural",
          maxAttempts: 1,
        }),
      ).rejects.toThrow(/scene count/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not set captions_source for zh targets", () => {
    expect(captionsSourceFor("en-US")).toBe("caption");
    expect(captionsSourceFor("zh-CN")).toBeUndefined();
  });

  it("reads the canonical language from frontmatter", () => {
    expect(canonicalLanguage(CANONICAL)).toBe("zh-CN");
  });
});
