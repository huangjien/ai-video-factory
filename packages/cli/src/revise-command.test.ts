import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { Command } from "commander";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerRevise, runRevise } from "./revise-command.js";

const ARTICLE_MD = `---
project: revise-test
language: zh-CN
duration_target_sec: 40
voice: zh-CN-YunjianNeural
---

# 评审回灌测试

> **Hook** (≤20s): 评审发现的钩子。

## 1. 第一节

第一节正文,保持不变。增长率为 37%。

## 2. 第二节

第二节正文,增长率为 37%。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_01
    duration: 20
    caption: A
    visual: "flow: 输入输出流程图"
    narration: 第一场景旁白,保持不变。
  - id: scene_02
    duration: 20
    caption: B
    visual: "compare: 左右对比"
    narration: 第二场景旁白,保持不变。
\`\`\`
`;

/** The reviser's answer: only the second scene's narration changes. */
const REVISION_JSON = JSON.stringify({
  title: "评审回灌测试",
  hook: "评审发现的钩子。",
  sections: [
    { heading: "第一节", body: "第一节正文,保持不变。增长率为 37%。" },
    { heading: "第二节", body: "第二节正文,增长率为 37%。" },
  ],
  scenes: [
    {
      id: "scene_01",
      duration: 20,
      caption: "A",
      visual: "flow: 输入输出流程图",
      narration: "第一场景旁白,保持不变。",
    },
    {
      id: "scene_02",
      duration: 20,
      caption: "B",
      visual: "compare: 左右对比",
      narration: "第二场景旁白,已经改过。",
    },
  ],
});

/** A judge answer that scores every indicator 5/5 → 100. */
const SCORE_JSON = JSON.stringify({
  dimension_scores: [
    {
      id: "A",
      indicators: [
        { id: "A1", score: 5 },
        { id: "A2", score: 5 },
        { id: "A3", score: 5 },
      ],
    },
    {
      id: "B",
      indicators: [
        { id: "B1", score: 5 },
        { id: "B2", score: 5 },
        { id: "B3", score: 5 },
      ],
    },
    {
      id: "C",
      indicators: [
        { id: "C1", score: 5 },
        { id: "C2", score: 5 },
        { id: "C3", score: 5 },
      ],
    },
    {
      id: "D",
      indicators: [
        { id: "D1", score: 5 },
        { id: "D2", score: 5 },
        { id: "D3", score: 5 },
      ],
    },
    {
      id: "E",
      indicators: [
        { id: "E1", score: 5 },
        { id: "E2", score: 5 },
        { id: "E3", score: 5 },
      ],
    },
    {
      id: "F",
      indicators: [
        { id: "F1", score: 5 },
        { id: "F2", score: 5 },
        { id: "F3", score: 5 },
      ],
    },
    {
      id: "G",
      indicators: [
        { id: "G1", score: 5 },
        { id: "G2", score: 5 },
        { id: "G3", score: 5 },
      ],
    },
    {
      id: "H",
      indicators: [
        { id: "H1", score: 5 },
        { id: "H2", score: 5 },
        { id: "H3", score: 5 },
      ],
    },
  ],
  findings: [],
  risk_flags: [],
  limitations: [],
  summary: {
    strengths: [],
    main_weaknesses: [],
    conclusion: "",
    confidence: 1,
  },
  comment: "ok",
  suggestions: [],
});

const CONTENT_REVIEW = `content:
  accuracy:
    status: ok
    evidence: null
    recommendation: null
  logic:
    status: ok
    evidence: null
    recommendation: null
  unsupported_claims:
    - id: F001
      severity: major
      reference: scene-02
      observation: 第二场景旁白缺少数据来源
      evidence: "第二场景旁白,保持不变。"
      recommendation: 补上来源说明
  contradictions: []
  repetition: []
  overall: warn
`;

const VISUAL_REVIEW = `visual:
  readability:
    status: ok
    evidence: null
    recommendation: null
  density:
    status: ok
    evidence: null
    recommendation: null
  pacing:
    status: ok
    evidence: null
    recommendation: null
  visual_hierarchy:
    status: ok
    evidence: null
    recommendation: null
  caption_length:
    status: ok
    evidence: null
    recommendation: null
  overall: pass
`;

const TECHNICAL_REVIEW = `technical:
  resolution:
    status: ok
    evidence: null
    recommendation: null
  fps:
    status: ok
    evidence: null
    recommendation: null
  audio:
    status: ok
    evidence: null
    recommendation: null
  subtitle:
    status: ok
    evidence: null
    recommendation: null
  missing_assets: []
  render_errors: []
  overall: pass
`;

/** The research agent's answer — a claim that could NOT be verified. */
const RESEARCH_JSON = JSON.stringify({
  markdown: "# 调研结果\n\n未能找到可核实的来源。",
  sources: [],
  claims: [
    {
      id: "c1",
      claim: "第二场景旁白,保持不变。",
      status: "uncertain",
      sources: [],
      note: "未找到可核实的来源，旁白应弱化该表述",
    },
  ],
  meta: {
    web_search_used: false,
    web_search_failed: true,
    provider: "minimax",
    model: "MiniMax-M3",
  },
});

/** The re-review's answer: the same shape, one marker string. */
const FULL_REVIEW_YAML = `${CONTENT_REVIEW.replace("第二场景旁白", "re-reviewed")}\n${VISUAL_REVIEW}\n${TECHNICAL_REVIEW}`;

/** A project with an article, a storyboard and the three review files. */
function setupProject(withReview: boolean): { cwd: string; root: string } {
  const cwd = mkdtempSync(path.join(tmpdir(), "video-revise-"));
  const root = path.join(cwd, "projects", "demo");
  mkdirSync(path.join(root, "review"), { recursive: true });
  mkdirSync(path.join(root, "storyboard"), { recursive: true });
  writeFileSync(
    path.join(root, "storyboard", "storyboard.yaml"),
    'schema_version: "0.2"\nproject:\n  id: demo\n  language: zh-CN\n',
    "utf8",
  );
  writeFileSync(path.join(root, "article.md"), ARTICLE_MD, "utf8");
  if (withReview) {
    writeFileSync(
      path.join(root, "review", "content-review.yaml"),
      CONTENT_REVIEW,
      "utf8",
    );
    writeFileSync(
      path.join(root, "review", "visual-review.yaml"),
      VISUAL_REVIEW,
      "utf8",
    );
    writeFileSync(
      path.join(root, "review", "technical-review.yaml"),
      TECHNICAL_REVIEW,
      "utf8",
    );
  }
  return { cwd, root };
}

describe("video revise — review findings become a targeted edit", () => {
  let server: Server;
  let baseUrl: string;
  const bodies: string[] = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = "";
      req.on("data", (c: Buffer) => {
        body += c.toString("utf8");
      });
      req.on("end", () => {
        bodies.push(body);
        const content = body.includes("Article Reviser")
          ? REVISION_JSON
          : body.includes("Review Agent")
            ? "```yaml\n" + FULL_REVIEW_YAML + "\n```"
            : body.includes("Research Agent")
              ? RESEARCH_JSON
              : SCORE_JSON;
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            choices: [
              { message: { content }, index: 0, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 400, completion_tokens: 250 },
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => new Promise<void>((r) => server.close(() => r())));

  it("edits only the passage the finding quotes, then re-scores", async () => {
    const { cwd, root } = setupProject(true);
    writeFileSync(
      path.join(root, "article-review.yaml"),
      "final_overall: 80\nfinal_grade: B\n",
      "utf8",
    );

    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    const code = await runRevise({
      project: "demo",
      cwd,
      model: "minimax",
      judgeModel: "minimax",
    });
    expect(code).toBe(0);

    const revised = readFileSync(path.join(root, "article.md"), "utf8");
    // The targeted passage changed.
    expect(revised).toContain("第二场景旁白,已经改过。");
    // Everything else survived byte-for-byte.
    expect(revised).toContain("第一节正文,保持不变。增长率为 37%。");
    expect(revised).toContain("第一场景旁白,保持不变。");
    expect(revised).toContain("voice: zh-CN-YunjianNeural");

    const record = readFileSync(path.join(root, "article-revise.yaml"), "utf8");
    expect(record).toContain("before_overall: 80");
    expect(record).toContain("after_overall: 100");
    expect(record).toContain("scene 2");
    expect(record).toContain("FACT_UNSUPPORTED_CLAIM");

    // The storyboard was refreshed from the revised article.
    const storyboard = readFileSync(
      path.join(root, "storyboard", "storyboard.yaml"),
      "utf8",
    );
    expect(storyboard).toContain("已经改过");

    // No regeneration: the draft prompt was never sent. The reviser may
    // retry once on a parse hiccup, so its call count is "at least one".
    expect(
      bodies.filter((b) => b.includes("Article Reviser")),
    ).not.toHaveLength(0);
    expect(bodies.filter((b) => b.includes("Article Drafter"))).toHaveLength(0);
  });

  it("registers the verb and runs it through commander", async () => {
    const { cwd } = setupProject(true);
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    const program = new Command();
    registerRevise(program);
    await program.parseAsync(
      [
        "revise",
        "demo",
        "--cwd",
        cwd,
        "--model",
        "minimax",
        "--judge-model",
        "minimax",
      ],
      { from: "user" },
    );
    expect(process.exitCode).toBe(0);
    process.exitCode = undefined;
  });

  it("re-reviews the revised project with --re-review", async () => {
    const { cwd, root } = setupProject(true);
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    const code = await runRevise({
      project: "demo",
      cwd,
      model: "minimax",
      judgeModel: "minimax",
      reReview: true,
    });
    expect(code).toBe(0);
    const contentReview = readFileSync(
      path.join(root, "review", "content-review.yaml"),
      "utf8",
    );
    expect(contentReview).toContain("re-reviewed");
  });

  it("refuses when the review files are missing", async () => {
    const { cwd } = setupProject(false);
    const code = await runRevise({
      project: "demo",
      cwd,
      model: "minimax",
      judgeModel: "minimax",
    });
    expect(code).toBe(1);
  });

  it("refuses an article without numbered sections", async () => {
    const { cwd, root } = setupProject(true);
    writeFileSync(
      path.join(root, "article.md"),
      ARTICLE_MD.replace(/^## 1\. /m, "## ").replace(/^## 2\. /m, "## "),
      "utf8",
    );
    const code = await runRevise({
      project: "demo",
      cwd,
      model: "minimax",
      judgeModel: "minimax",
    });
    expect(code).toBe(1);
  });
});
