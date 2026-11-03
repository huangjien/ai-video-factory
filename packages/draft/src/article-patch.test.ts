import { describe, expect, it } from "vitest";
import { articleMdToRawArticle, parseArticle } from "./schemas.js";
import { applyRevisionToMarkdown } from "./article-patch.js";
import type { RawArticle } from "./agent.js";

const ARTICLE_MD = `---
project: patch-test
language: zh-CN
duration_target_sec: 40
voice: zh-CN-YunjianNeural
setting: Tang-dynasty China, 626 CE
---

# 补丁测试

> **Hook** (≤20s): 一个钩子。

## 1. 第一节

第一节正文,保持不变。

## 2. 第二节

第二节正文,需要修改。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_01
    duration: 20
    caption: A
    visual: "flow: 输入输出流程图"
    narration: 第一场景旁白,保持不变。
    characters:
      - id: char-1
  - id: scene_02
    duration: 20
    caption: B
    visual: "compare: 左右对比"
    narration: 第二场景旁白,需要修改。
    hold_after_sec: 1
\`\`\`
`;

function base(): RawArticle {
  return articleMdToRawArticle(parseArticle(ARTICLE_MD));
}

describe("applyRevisionToMarkdown", () => {
  it("replaces only the changed section and leaves the rest byte-identical", () => {
    const b = base();
    const fixed: RawArticle = {
      ...b,
      sections: (b.sections ?? []).map((s, i) =>
        i === 1
          ? { heading: s.heading ?? "", body: "第二节正文,已经改过。" }
          : s,
      ),
    };
    const { markdown, changed } = applyRevisionToMarkdown(ARTICLE_MD, b, fixed);
    expect(markdown).toContain("第二节正文,已经改过。");
    expect(markdown).toContain("第一节正文,保持不变。");
    expect(markdown).toContain("第一场景旁白,保持不变。");
    expect(changed).toEqual(["section 2"]);
    // The frontmatter survives verbatim, unknown keys included.
    expect(markdown).toContain("setting: Tang-dynasty China, 626 CE");
    // The section heading keeps its number, without doubling it.
    expect(markdown).toContain("## 2. 第二节");
    expect(markdown).not.toContain("## 2. 2. 第二节");
  });

  it("keeps the scene keys the reviser never saw", () => {
    const b = base();
    const fixed: RawArticle = {
      ...b,
      scenes: (b.scenes ?? []).map((s, i) =>
        i === 1 ? { ...s, narration: "第二场景旁白,已经改过。" } : s,
      ),
    };
    const { markdown, changed } = applyRevisionToMarkdown(ARTICLE_MD, b, fixed);
    expect(markdown).toContain("第二场景旁白,已经改过。");
    expect(markdown).toContain("characters:");
    expect(markdown).toContain("hold_after_sec: 1");
    expect(changed).toEqual(["scene 2"]);
  });

  it("patches the title and the hook", () => {
    const b = base();
    const fixed: RawArticle = { ...b, title: "新的标题", hook: "新的钩子。" };
    const { markdown, changed } = applyRevisionToMarkdown(ARTICLE_MD, b, fixed);
    expect(markdown).toContain("# 新的标题");
    expect(markdown).toContain("> **Hook** (≤20s): 新的钩子。");
    expect(changed).toEqual(["title", "hook"]);
  });

  it("returns the file unchanged when the revision changed nothing", () => {
    const b = base();
    const { markdown, changed } = applyRevisionToMarkdown(ARTICLE_MD, b, b);
    expect(markdown).toBe(ARTICLE_MD);
    expect(changed).toEqual([]);
  });

  it("leaves a field alone when only its trailing newline changed", () => {
    // The reviser echoes the article it was given; the echoed value
    // loses the block scalar's trailing newline. That is not a change —
    // writing it back would flip `|` to `|-` on every untouched scene.
    const md = ARTICLE_MD.replace(
      "    narration: 第二场景旁白,需要修改。\n",
      "    narration: |\n      第二场景旁白,\n      需要修改。\n",
    );
    const b = articleMdToRawArticle(parseArticle(md));
    const fixed: RawArticle = {
      ...b,
      scenes: (b.scenes ?? []).map((s, i) =>
        i === 1 ? { ...s, narration: (s.narration ?? "").trim() } : s,
      ),
    };
    const { markdown, changed } = applyRevisionToMarkdown(md, b, fixed);
    expect(markdown).toBe(md);
    expect(changed).toEqual([]);
  });

  it("keeps a block-scalar narration a block scalar", () => {
    const md = ARTICLE_MD.replace(
      "    narration: 第二场景旁白,需要修改。\n",
      "    narration: |\n      第二场景旁白,\n      需要修改。\n",
    );
    const b = articleMdToRawArticle(parseArticle(md));
    const fixed: RawArticle = {
      ...b,
      scenes: (b.scenes ?? []).map((s, i) =>
        i === 1 ? { ...s, narration: "第二场景旁白,已经改过。" } : s,
      ),
    };
    const { markdown } = applyRevisionToMarkdown(md, b, fixed);
    expect(markdown).toContain("narration: |");
    expect(markdown).toContain("第二场景旁白,已经改过。");
    // The untouched scene keeps its own block scalar untouched.
    expect(markdown).toContain("第一场景旁白,保持不变。");
  });
});
