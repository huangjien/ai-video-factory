import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractOverlapKeywords, nearDuplicateOf, scanOverlap } from "./backlog-overlap.js";

let repoRoot: string;
beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), "video-backlog-overlap-"));
});
afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function addArticle(project: string, body: string): void {
  const dir = path.join(repoRoot, "projects", project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "article.md"), body, "utf8");
}

describe("extractOverlapKeywords — noise filtering", () => {
  it("drops generic CJK shingles like 为什/什么 from 为什么…", () => {
    const kws = extractOverlapKeywords({ topic: "为什么预备役存在" });
    expect(kws).not.toContain("为什");
    expect(kws).not.toContain("什么");
    expect(kws).toContain("预备");
    expect(kws).toContain("预备役");
  });

  it("drops English stopwords (the/why/how…)", () => {
    const kws = extractOverlapKeywords({
      topic: "Why the machines cannot hear the alarm",
    });
    expect(kws).not.toContain("the");
    expect(kws).not.toContain("why");
    expect(kws).not.toContain("how");
    expect(kws).toContain("machines");
    expect(kws).toContain("alarm");
  });

  it("keeps anchors verbatim ahead of derived keywords", () => {
    const kws = extractOverlapKeywords({
      topic: "为什么停火线能冻结几十年",
      anchors: ["板门店停战协定"],
    });
    expect(kws[0]).toBe("板门店停战协定");
    expect(kws).toContain("停火线");
  });
});

describe("scanOverlap — per-article verdict", () => {
  it("reports an article on ≥2 matched keywords in it", () => {
    addArticle("任务式指挥", "# 任务式指挥\n\n条令、放权、委托、任务式指挥的现代形态。");
    const hits = scanOverlap(repoRoot, {
      topic: "任务式指挥与条令",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.project).toBe("任务式指挥");
    expect(hits[0]?.keywords.length).toBeGreaterThanOrEqual(2);
  });

  it("never reports on a single generic shingle", () => {
    // 21 articles contain 停火-adjacent noise in the old world; here ONE
    // short shingle in one article must stay silent.
    addArticle("写故事", "# 写故事\n\n停火是一个情节工具。");
    const hits = scanOverlap(repoRoot, { topic: "停火协议的监督机制" });
    expect(hits).toEqual([]);
  });

  it("a single ANCHOR hit is already a verdict", () => {
    addArticle("雇佣军奖励", "# 雇佣军\n\n板门店停战协定的另一个故事。");
    const hits = scanOverlap(repoRoot, {
      topic: "全新主题",
      anchors: ["板门店停战协定"],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.keywords).toContain("板门店停战协定");
  });

  it("keywords spread across DIFFERENT articles do not combine", () => {
    addArticle("a", "# A\n\n潜艇兵的选拔。");
    addArticle("b", "# B\n\n航母甲板的调度。");
    const hits = scanOverlap(repoRoot, { topic: "潜艇航母" });
    // 潜艇 alone is a 2-char shingle — one article, one shingle, no verdict.
    expect(hits).toEqual([]);
  });

  it("returns no hits on a missing projects dir", () => {
    expect(scanOverlap(repoRoot, { topic: "anything at all" })).toEqual([]);
  });
});

describe("nearDuplicateOf — reworded twins", () => {
  it("catches a 玄武门之变 retelling across different wordings", () => {
    const twin = nearDuplicateOf(
      "玄武门之变：一场改变唐朝走向的宫门伏杀",
      ["玄武门之变：宫门伏杀如何改变唐朝走向", "停火线机制"],
    );
    expect(twin).toBe("玄武门之变：宫门伏杀如何改变唐朝走向");
  });

  it("passes genuinely different topics", () => {
    expect(
      nearDuplicateOf("为什么军官要定期轮岗", ["为什么停火线能冻结几十年"]),
    ).toBeNull();
  });

  it("returns the BEST match when several are close", () => {
    const twin = nearDuplicateOf(
      "Shadow-mode AI decision surfaces",
      ["Shadow mode: how AI earns the right to act", "中国画颜色的来源"],
    );
    expect(twin).toBe("Shadow mode: how AI earns the right to act");
  });
});
