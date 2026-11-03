import { describe, expect, it } from "vitest";
import { ReviewPackageSchema, type ReviewPackage } from "@video/review";
import { articleMdToRawArticle, parseArticle } from "./schemas.js";
import {
  NO_SOURCE_RULE,
  guardUnverifiedFact,
  planReviewRevision,
  TECHNICAL_SKIP_REASON,
} from "./review-feedback.js";

const ARTICLE_MD = `---
project: feedback-test
language: zh-CN
duration_target_sec: 40
voice: zh-CN-YunjianNeural
---

# 反馈测试

> **Hook** (≤20s): 一个用来验证评审反馈的钩子。

## 1. 第一节

第一节正文。增长率为 37%，这个数字来自二手报道。

## 2. 第二节

第二节正文。结论是因果关系成立。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_01
    duration: 20
    caption: A
    visual: "flow: 输入输出流程图"
    narration: 第一场景旁白，讲清楚了输入和输出。
  - id: scene_02
    duration: 20
    caption: B
    visual: "compare: 左右对比"
    narration: 第二场景旁白，对比了两组数据。
\`\`\`
`;

function article() {
  return articleMdToRawArticle(parseArticle(ARTICLE_MD));
}

function review(overrides: {
  contradictions?: ReviewPackage["content"]["contradictions"];
  logic?: Partial<ReviewPackage["content"]["logic"]>;
  unsupported?: ReviewPackage["content"]["unsupported_claims"];
  technicalFps?: Partial<ReviewPackage["technical"]["fps"]>;
}): ReviewPackage {
  const base = {
    content: {
      accuracy: { status: "ok", evidence: null, recommendation: null },
      logic: {
        status: "ok",
        evidence: null,
        recommendation: null,
        ...(overrides.logic ?? {}),
      },
      unsupported_claims: overrides.unsupported ?? [],
      contradictions: overrides.contradictions ?? [],
      repetition: [],
      overall: "warn",
    },
    visual: {
      readability: { status: "ok", evidence: null, recommendation: null },
      density: { status: "ok", evidence: null, recommendation: null },
      pacing: { status: "ok", evidence: null, recommendation: null },
      visual_hierarchy: { status: "ok", evidence: null, recommendation: null },
      caption_length: { status: "ok", evidence: null, recommendation: null },
      overall: "pass",
    },
    technical: {
      resolution: { status: "ok", evidence: null, recommendation: null },
      fps: {
        status: "ok",
        evidence: null,
        recommendation: null,
        ...(overrides.technicalFps ?? {}),
      },
      audio: { status: "ok", evidence: null, recommendation: null },
      subtitle: { status: "ok", evidence: null, recommendation: null },
      missing_assets: [],
      render_errors: [],
      overall: "pass",
    },
  };
  const parsed = ReviewPackageSchema.safeParse(base);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

describe("planReviewRevision", () => {
  it("turns a quoted contradiction into a finding with a verbatim quote", () => {
    const plan = planReviewRevision(
      review({
        contradictions: [
          {
            id: "C1",
            severity: "major",
            reference: "section-2",
            observation: "第二节的结论与第一节冲突",
            evidence: "结论是因果关系成立。",
            recommendation: "改写第二节的结论",
          },
        ],
      }),
      article(),
    );
    expect(plan.findings).toHaveLength(1);
    expect(plan.findings[0]?.quote).toBe("结论是因果关系成立。");
    expect(plan.findings[0]?.severity).toBe("Major");
    expect(plan.findings[0]?.code).toBe("REVIEW_CONTRADICTIONS");
    expect(plan.skipped).toHaveLength(0);
  });

  it("uses the explicit field and reference the review agent supplies", () => {
    const plan = planReviewRevision(
      review({
        contradictions: [
          {
            id: "C9",
            severity: "major",
            reference: "scene-02",
            observation: "字幕太长",
            evidence: null,
            recommendation: "缩短字幕",
            field: "caption",
            quote: null,
          },
        ],
      }),
      article(),
    );
    expect(plan.findings).toHaveLength(1);
    // The named field of the named scene — no guessing.
    expect(plan.findings[0]?.quote).toBe("B");
  });

  it("uses the explicit quote the review agent supplies", () => {
    const plan = planReviewRevision(
      review({
        contradictions: [
          {
            id: "C10",
            severity: "major",
            reference: "scene-02",
            observation: "旁白里的对比缺少基准",
            evidence: null,
            recommendation: "补上基准",
            field: "narration",
            quote: "第二场景旁白，对比了两组数据。",
          },
        ],
      }),
      article(),
    );
    expect(plan.findings).toHaveLength(1);
    expect(plan.findings[0]?.quote).toBe("第二场景旁白，对比了两组数据。");
  });

  it("skips a finding whose evidence quotes nothing in the article", () => {
    const plan = planReviewRevision(
      review({
        contradictions: [
          {
            id: "C1",
            severity: "minor",
            reference: null,
            observation: "结构有点松",
            evidence: "这篇文章读起来不够紧凑",
            recommendation: "收紧结构",
          },
        ],
      }),
      article(),
    );
    expect(plan.findings).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toContain("no verbatim passage");
  });
  it("prefers a verbatim passage over the unit the finding names", () => {
    const plan = planReviewRevision(
      review({
        contradictions: [
          {
            id: "C2",
            severity: "critical",
            reference: "scene-02",
            observation: "第二场景的对比缺少基准",
            evidence: "对比了两组数据",
            recommendation: "补上基准",
          },
        ],
      }),
      article(),
    );
    expect(plan.findings).toHaveLength(1);
    expect(plan.findings[0]?.quote).toBe("对比了两组数据");
    expect(plan.findings[0]?.severity).toBe("Critical");
  });

  it("falls back to the named scene when the finding quotes nothing", () => {
    const plan = planReviewRevision(
      review({
        contradictions: [
          {
            id: "C3",
            severity: "major",
            reference: "scene-02",
            observation: "第二场景的对比缺少基准",
            evidence: "第二场景的旁白缺少与上一场景的对照基准",
            recommendation: "补上基准",
          },
        ],
      }),
      article(),
    );
    expect(plan.findings).toHaveLength(1);
    expect(plan.findings[0]?.quote).toContain("第二场景旁白");
  });

  it("skips a finding that names a scene but is not about its text", () => {
    const plan = planReviewRevision(
      review({
        contradictions: [
          {
            id: "C4",
            severity: "minor",
            reference: "script scenes block (scene_1…scene_20)",
            observation: "场景 ID 的命名规范在两个产物里不一致",
            evidence:
              "script: id: scene_1 … id: scene_20; storyboard: id: scene-01.",
            recommendation: "统一场景 ID 命名",
          },
        ],
      }),
      article(),
    );
    expect(plan.findings).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toContain(
      "does not say which of its texts",
    );
  });

  it("keeps only the first finding when two target the same passage", () => {
    const plan = planReviewRevision(
      review({
        contradictions: [
          {
            id: "C1",
            severity: "major",
            reference: null,
            observation: "a",
            evidence: "第二节正文。",
            recommendation: "fix a",
          },
          {
            id: "C2",
            severity: "minor",
            reference: null,
            observation: "b",
            evidence: "第二节正文。",
            recommendation: "fix b",
          },
        ],
      }),
      article(),
    );
    expect(plan.findings).toHaveLength(1);
    expect(plan.skipped.some((s) => s.id === "C2")).toBe(true);
  });

  it("skips technical findings — they describe the render, not the article", () => {
    const plan = planReviewRevision(
      review({ technicalFps: { status: "fail", evidence: "fps is 12" } }),
      article(),
    );
    expect(plan.findings).toHaveLength(0);
    expect(plan.skipped.some((s) => s.reason === TECHNICAL_SKIP_REASON)).toBe(
      true,
    );
  });

  it("maps a warn scalar finding to a Moderate finding", () => {
    const plan = planReviewRevision(
      review({
        logic: {
          status: "warn",
          evidence: "第一节正文。",
          recommendation: "理顺逻辑",
        },
      }),
      article(),
    );
    expect(plan.findings).toHaveLength(1);
    expect(plan.findings[0]?.severity).toBe("Moderate");
    expect(plan.findings[0]?.code).toBe("REVIEW_CONTENT_LOGIC");
  });

  it("ignores scalars the judge marked ok", () => {
    const plan = planReviewRevision(review({}), article());
    expect(plan.findings).toHaveLength(0);
  });

  it("codes an unsupported claim as FACT_ so the research guard picks it up", () => {
    const plan = planReviewRevision(
      review({
        unsupported: [
          {
            id: "F001",
            severity: "major",
            reference: "scene-02",
            observation: "第二场景的旁白没有来源",
            evidence: "第二场景旁白,保持不变。",
            recommendation: "补上来源",
          },
        ],
      }),
      article(),
    );
    expect(plan.findings[0]?.code).toBe("FACT_UNSUPPORTED_CLAIM");
  });
});

describe("the article says each claim twice", () => {
  const DUP_ARTICLE_MD = `---
project: dup-test
language: zh-CN
duration_target_sec: 40
voice: v
---

# 双份

## 1. 第一节

增长率为 37%，这个数字来自二手的报道。别的内容。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_01
    duration: 20
    caption: A
    visual: "flow: x"
    narration: 增长率为 37%，这个数字来自二手报道。
\`\`\`
`;

  it("gives a finding a second target in the prose copy of the same claim", () => {
    const base = articleMdToRawArticle(parseArticle(DUP_ARTICLE_MD));
    const plan = planReviewRevision(
      review({
        contradictions: [
          {
            id: "C1",
            severity: "major",
            reference: "scene-01",
            observation: "这个数字没有来源",
            evidence: "增长率为 37%，这个数字来自二手报道。",
            recommendation: "补上来源",
          },
        ],
      }),
      base,
    );
    expect(plan.findings).toHaveLength(2);
    expect(plan.findings[0]?.id).toBe("C1");
    expect(plan.findings[1]?.id).toMatch(/^C1@(prose|scene)$/);
    // The prose copy carries the same claim (worded slightly
    // differently) — the reviser must fix both.
    expect(plan.findings[1]?.quote).toContain("增长率为 37%");
    expect(plan.findings[1]?.recommendation).toBe(
      plan.findings[0]?.recommendation,
    );
  });

  it("needs no second target when the two copies are word for word equal", () => {
    const md = DUP_ARTICLE_MD.replace("来自二手的报道", "来自二手报道");
    const base = articleMdToRawArticle(parseArticle(md));
    const plan = planReviewRevision(
      review({
        contradictions: [
          {
            id: "C1",
            severity: "major",
            reference: "scene-01",
            observation: "这个数字没有来源",
            evidence: "增长率为 37%，这个数字来自二手报道。",
            recommendation: "补上来源",
          },
        ],
      }),
      base,
    );
    // One quote covers both copies — the reviser's quote is contained
    // in the scene AND in the section, so both are editable.
    expect(plan.findings).toHaveLength(1);
  });

  it("does not invent a sibling for a claim that exists once", () => {
    const plan = planReviewRevision(
      review({
        contradictions: [
          {
            id: "C1",
            severity: "major",
            reference: null,
            observation: "结论有问题",
            evidence: "结论是因果关系成立。",
            recommendation: "改写结论",
          },
        ],
      }),
      article(),
    );
    expect(plan.findings).toHaveLength(1);
  });
});

describe("guardUnverifiedFact", () => {
  it("states the no-source rule on the finding the model is looking at", () => {
    const guarded = guardUnverifiedFact({
      id: "F001",
      code: "FACT_UNSUPPORTED_CLAIM",
      severity: "Major",
      quote: "余世存说过：…",
      description: "an unsourced attribution",
      recommendation: "Verify the quote's attribution",
    });
    expect(guarded.recommendation).toContain("Verify the quote's attribution");
    expect(guarded.recommendation).toContain(NO_SOURCE_RULE);
  });

  it("overrides a recommendation that itself names a source", () => {
    // The real failure: the review's recommendation suggested the very
    // citation the guard exists to block (《时间之书》), and the reviser
    // followed it. The rule must name the conflict, not just add a rule.
    const guarded = guardUnverifiedFact({
      id: "F001",
      code: "FACT_UNSUPPORTED_CLAIM",
      severity: "Moderate",
      quote: "有一句话说：…",
      description: "unattributed saying",
      recommendation:
        "add an attribution (widely attributed to 余世存's preface to 《时间之书》)",
    });
    expect(guarded.recommendation).toContain("OVERRIDE");
    expect(guarded.recommendation).toContain("DISREGARD that part");
  });
});
