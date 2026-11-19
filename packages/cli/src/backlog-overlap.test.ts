import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractOverlapKeywords, scanOverlap } from "./backlog-overlap.js";

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

describe("extractOverlapKeywords", () => {
  it("prioritizes anchors, then topic, capped in total", () => {
    const kws = extractOverlapKeywords({
      topic: "为什么停火线能冻结几十年",
      anchors: ["板门店停战协定", "克什米尔"],
      note: "监督机制",
      content: "很长的笔记内容。".repeat(30),
    });
    expect(kws[0]).toBe("板门店停战协定");
    expect(kws).toContain("克什米尔");
    expect(kws.length).toBeLessThanOrEqual(40);
    expect(new Set(kws).size).toBe(kws.length);
  });

  it("keeps latin words and CJK bigrams", () => {
    const kws = extractOverlapKeywords({ topic: "LLM token economy 与首token" });
    expect(kws).toContain("llm");
    expect(kws).toContain("token");
    expect(kws.some((k) => /[\u4e00-\u9fff]{2}/.test(k))).toBe(true);
  });
});

describe("scanOverlap", () => {
  it("finds keywords in existing articles and names the projects", () => {
    addArticle("任务式指挥", "# 任务式指挥\n\n条令、放权、委托。");
    addArticle("扁平化组织", "# 扁平化\n\n任务式指挥的现代形态。");
    const hits = scanOverlap(repoRoot, ["任务式指挥", "条令", "舰载机联队"]);
    const byKeyword = new Map(hits.map((h) => [h.keyword, h.projects]));
    expect(byKeyword.get("任务式指挥")).toEqual([
      "任务式指挥",
      "扁平化组织",
    ]);
    expect(byKeyword.get("条令")).toEqual(["任务式指挥"]);
    expect(byKeyword.has("舰载机联队")).toBe(false);
  });

  it("returns no hits on a missing projects dir", () => {
    expect(scanOverlap(repoRoot, ["anything"])).toEqual([]);
  });
});
