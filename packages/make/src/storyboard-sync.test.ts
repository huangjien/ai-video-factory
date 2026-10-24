import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArticleWithRecovery } from "@video/draft";
import { syncStoryboardFromArticle } from "./index.js";

/**
 * Content-aware storyboard sync (2026-10-24): ids matching is not enough —
 * article content that feeds the storyboard (captions_source, per-scene
 * caption/visual/narration) must trigger re-derivation, while pure hand
 * edits to storyboard.yaml are preserved when article.md is unchanged.
 */

const ARTICLE = `---
project: sync-test
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
    visual: 一只茶壶放在木桌上
    narration: 第一句。
  - id: scene_2
    duration: 5
    caption: 二
    visual: 一杯茶冒着热气
    narration: 第二句。
\`\`\`
`;

async function mkProject(): Promise<{
  dir: string;
  article: ReturnType<typeof parseArticleWithRecovery>["article"];
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "sync-"));
  await writeFile(path.join(dir, "article.md"), ARTICLE, "utf8");
  const parsed = parseArticleWithRecovery(ARTICLE);
  // First sync creates the storyboard (fresh-derive path).
  await syncStoryboardFromArticle(dir, parsed.article);
  return { dir, article: parsed.article };
}

describe("content-aware storyboard sync", () => {
  it("unchanged article: sync is a no-op (hand edits preserved)", async () => {
    const { dir, article } = await mkProject();
    try {
      const sb = path.join(dir, "storyboard", "storyboard.yaml");
      await writeFile(sb, await readFile(sb, "utf8"), "utf8");
      const lines = await syncStoryboardFromArticle(dir, article);
      expect(lines).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("edited visual line (same ids): storyboard re-derives", async () => {
    const { dir, article } = await mkProject();
    try {
      const sbPath = path.join(dir, "storyboard", "storyboard.yaml");
      const hashPath = path.join(dir, "storyboard", ".derived-hash");
      const hashBefore = await readFile(hashPath, "utf8");

      const edited = ARTICLE.replace(
        "一只茶壶放在木桌上",
        "一只发着光的新茶壶放在木桌上",
      );
      const reparsed = parseArticleWithRecovery(edited).article;
      const lines = await syncStoryboardFromArticle(dir, reparsed);
      expect(lines.join("\n")).toMatch(/re-derived|synced/);
      expect(await readFile(hashPath, "utf8")).not.toBe(hashBefore);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("captions_source flip re-derives into source: caption blocks", async () => {
    const { dir, article } = await mkProject();
    try {
      const sbPath = path.join(dir, "storyboard", "storyboard.yaml");
      const edited = ARTICLE.replace(
        "duration_target_sec: 12",
        "duration_target_sec: 12\ncaptions_source: caption",
      );
      const reparsed = parseArticleWithRecovery(edited).article;
      await syncStoryboardFromArticle(dir, reparsed);
      const after = await readFile(sbPath, "utf8");
      expect(after).toContain("source: caption");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("no article change after a hand edit: hand edit survives", async () => {
    const { dir, article } = await mkProject();
    try {
      const sbPath = path.join(dir, "storyboard", "storyboard.yaml");
      const handEdited = (await readFile(sbPath, "utf8")).replace(
        "component: Title",
        "component: QuoteBlock",
      );
      await writeFile(sbPath, handEdited, "utf8");
      const lines = await syncStoryboardFromArticle(dir, article);
      expect(lines).toEqual([]);
      expect(await readFile(sbPath, "utf8")).toContain("component: QuoteBlock");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
