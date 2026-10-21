import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";
import {
  ArticleScoreRawSchema,
  buildArticleReviewMessages,
  DEFAULT_MIN_SCORE,
  MAX_POSSIBLE_SCORE,
  PROFILE,
  PROFILE_ID,
  computeScore,
  dropHallucinatedQuotes,
  gradeFor,
  renderArticleReviewYaml,
  runScoredDraft,
  scoreArticle,
  scoreTotal,
} from "./article-review.js";

/** Fake provider: pops one canned response per chat() call, in order.
 *  Call sequence in the loop is draft, judge, draft, judge, … */
class FakeProvider implements Provider {
  readonly name = "fake";
  public requests: ChatRequest[] = [];
  constructor(private responses: string[]) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(req);
    const content =
      this.responses.length > 1
        ? (this.responses.shift() as string)
        : (this.responses[0] ?? "");
    return { content, usage: { input: 10, output: 20 } };
  }
}

const GOOD_ARTICLE = JSON.stringify({
  title: "t",
  hook: "h",
  sections: [{ heading: "s", body: "b" }],
  scenes: [
    {
      id: "scene_1",
      duration: 8,
      caption: "c",
      visual: "v",
      narration: "narration line",
    },
  ],
});

/** Build a minimum-valid raw payload with two indicators per dimension
 *  at score 4 (a passing draft). Shortcuts review-test boilerplate. */
function buildPassingRaw(score = 4): string {
  const dimensions = PROFILE.map((d) => ({
    id: d.id,
    indicators: d.indicators.map((i) => ({
      id: i.id,
      score,
      reason: "ok",
    })),
  }));
  return JSON.stringify({
    dimension_scores: dimensions,
    findings: [],
    risk_flags: [],
    limitations: [],
    summary: { strengths: [], main_weaknesses: [], conclusion: "", confidence: 0.5 },
    comment: "looks good",
    suggestions: [],
  });
}

/** Same shape but a finding is attached so the loop has something to
 *  pass into the next draft. The quote must appear in GOOD_ARTICLE
 *  to survive the evidence pass. */
function buildRawWithFinding(
  severity: "Critical" | "Major" | "Moderate" | "Minor" = "Major",
): string {
  const dimensions = PROFILE.map((d) => ({
    id: d.id,
    indicators: d.indicators.map((i) => ({
      id: i.id,
      score: severity === "Critical" ? 2 : 3,
      reason: "ok",
    })),
  }));
  return JSON.stringify({
    dimension_scores: dimensions,
    findings: [
      {
        id: "F-001",
        code: "LOGIC_GAP",
        severity,
        dimension_ids: ["B"],
        indicator_ids: ["B1"],
        location: { quote: "narration line" },
        description: "needs more support",
        impact: "central claim weak",
        recommendation: "add a number",
        confidence: 0.9,
        verification_status: "verified_in_text",
      },
    ],
    risk_flags:
      severity === "Critical" || severity === "Major"
        ? [
            {
              code:
                severity === "Critical"
                  ? "CRITICAL_BLOCKER"
                  : "MAJOR_REVISION_NEEDED",
              severity,
              finding_ids: ["F-001"],
            },
          ]
        : [],
    limitations: [],
    summary: { strengths: [], main_weaknesses: ["logic gap"], conclusion: "revise", confidence: 0.8 },
    comment: "the single biggest weakness",
    suggestions: [
      "scene_1 — add a concrete number",
      "section 1 — name the year before the figure",
    ],
  });
}

const INPUT = {
  topic: "demo",
  audience: "developers",
  language: "zh-CN" as const,
  duration: 60,
};

// ---------------------------------------------------------------------------
// Schema & engine.
// ---------------------------------------------------------------------------

describe("PROFILE", () => {
  it("ships the canonical 8 dimensions × 24 indicators", () => {
    expect(PROFILE).toHaveLength(8);
    const totals = PROFILE.map((d) =>
      d.indicators.reduce((sum, i) => sum + i.weight, 0),
    );
    expect(totals).toEqual([15, 15, 12, 15, 12, 10, 13, 8]);
    expect(MAX_POSSIBLE_SCORE).toBe(100);
  });

  it("uses general_article_v1 as the profile id", () => {
    expect(PROFILE_ID).toBe("general_article_v1");
  });
});

describe("ArticleScoreRawSchema", () => {
  it("accepts a minimal valid payload", () => {
    const r = ArticleScoreRawSchema.safeParse(
      JSON.parse(buildPassingRaw()),
    );
    expect(r.success).toBe(true);
  });

  it("rejects a payload missing dimension_scores", () => {
    const r = ArticleScoreRawSchema.safeParse({ comment: "x" });
    expect(r.success).toBe(false);
  });

  it("coerces / clamps indicator scores into 0-5 integers", () => {
    const r = ArticleScoreRawSchema.safeParse(
      JSON.parse(buildPassingRaw(7)),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    const a3 = r.data.dimension_scores
      .find((d) => d.id === "A")!
      .indicators.find((i) => i.id === "A1")!.score;
    expect(a3).toBe(5);
  });

  it("rejects an unknown dimension id", () => {
    const bad = JSON.parse(buildPassingRaw());
    bad.dimension_scores.push({
      id: "Z",
      indicators: [{ id: "Z1", score: 3, reason: "" }],
    });
    const r = ArticleScoreRawSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });
});

describe("computeScore", () => {
  it("an all-4 draft hits 80/100 (B grade)", () => {
    const parsed = ArticleScoreRawSchema.parse(JSON.parse(buildPassingRaw(4)));
    const c = computeScore(parsed);
    expect(c.overall_score).toBe(80);
    expect(c.grade).toBe("B");
    expect(c.coverage).toBe(100);
  });

  it("an all-3 draft hits 60/100 (D grade)", () => {
    const parsed = ArticleScoreRawSchema.parse(JSON.parse(buildPassingRaw(3)));
    const c = computeScore(parsed);
    expect(c.overall_score).toBe(60);
    expect(c.grade).toBe("D");
  });

  it("an all-5 draft hits 100/100 (A grade)", () => {
    const parsed = ArticleScoreRawSchema.parse(JSON.parse(buildPassingRaw(5)));
    const c = computeScore(parsed);
    expect(c.overall_score).toBe(100);
    expect(c.grade).toBe("A");
  });

  it("weights the dimensions proportionally", () => {
    // All 4 except A is 0 → A loses its 15 share, others stay at 4.
    const parsed = ArticleScoreRawSchema.parse(JSON.parse(buildPassingRaw(4)));
    for (const d of parsed.dimension_scores) {
      if (d.id === "A") {
        for (const i of d.indicators) i.score = 0;
      }
    }
    const c = computeScore(parsed);
    // (100 - 15) of weight at 4/5 = 85 * 4/5 = 68
    expect(c.overall_score).toBe(68);
    expect(c.grade).toBe("D");
  });

  it("reports each dimension's weighted score", () => {
    const parsed = ArticleScoreRawSchema.parse(JSON.parse(buildPassingRaw(4)));
    const c = computeScore(parsed);
    const a = c.dimension_scores.find((d) => d.id === "A")!;
    expect(a.weight).toBe(15);
    expect(a.weighted_score).toBe(12); // 15 * (4/5)
  });
});

describe("gradeFor", () => {
  it("maps the framework's bands", () => {
    expect(gradeFor(95)).toBe("A");
    expect(gradeFor(89)).toBe("B");
    expect(gradeFor(80)).toBe("B");
    expect(gradeFor(70)).toBe("C");
    expect(gradeFor(60)).toBe("D");
    expect(gradeFor(59)).toBe("F");
  });
});

describe("DEFAULT_MIN_SCORE", () => {
  it("sets the acceptance bar at grade A (90/100)", () => {
    expect(DEFAULT_MIN_SCORE).toBe(90);
  });
});

describe("dropHallucinatedQuotes", () => {
  it("keeps findings whose quote appears in the article", () => {
    const parsed = ArticleScoreRawSchema.parse(
      JSON.parse(buildRawWithFinding()),
    );
    const { kept, dropped } = dropHallucinatedQuotes(
      parsed.findings,
      GOOD_ARTICLE,
    );
    expect(kept).toHaveLength(1);
    expect(dropped).toEqual([]);
  });

  it("drops findings whose quote does NOT appear", () => {
    const raw = JSON.parse(buildRawWithFinding());
    raw.findings[0].location.quote = "this string is not in the article";
    const parsed = ArticleScoreRawSchema.parse(raw);
    const { kept, dropped } = dropHallucinatedQuotes(
      parsed.findings,
      GOOD_ARTICLE,
    );
    expect(kept).toHaveLength(0);
    expect(dropped).toEqual(["F-001"]);
  });

  it("marks very short quotes for external check, does not drop them", () => {
    const raw = JSON.parse(buildRawWithFinding());
    raw.findings[0].location.quote = "ok";
    const parsed = ArticleScoreRawSchema.parse(raw);
    const { kept, dropped } = dropHallucinatedQuotes(
      parsed.findings,
      GOOD_ARTICLE,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.verification_status).toBe("needs_external_check");
    expect(dropped).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scoreArticle (full pipeline).
// ---------------------------------------------------------------------------

describe("scoreArticle", () => {
  it("computes overall_score 80 for an all-4 raw payload", async () => {
    const p = new FakeProvider([buildPassingRaw(4)]);
    const s = await scoreArticle(GOOD_ARTICLE, p);
    expect(s.computed.overall_score).toBe(80);
    expect(s.computed.grade).toBe("B");
    expect(s.total).toBe(80);
    expect(s.profile_id).toBe(PROFILE_ID);
  });

  it("passes an all-4 draft (≥ 70) with no findings", async () => {
    const p = new FakeProvider([buildPassingRaw(4)]);
    const s = await scoreArticle(GOOD_ARTICLE, p);
    expect(s.passing).toBe(true);
    expect(s.comment).toBe("looks good");
  });

  it("an all-3 draft has no Critical blocker (bar check is the loop's job)", async () => {
    const p = new FakeProvider([buildPassingRaw(3)]);
    const s = await scoreArticle(GOOD_ARTICLE, p);
    // ArticleScore.passing only reflects the Critical-blocker check;
    // the numeric bar (minScore) lives on the loop side.
    expect(s.passing).toBe(true);
    expect(s.computed.overall_score).toBe(60);
  });

  it("drops findings whose quote is not in the article", async () => {
    const raw = JSON.parse(buildRawWithFinding());
    raw.findings[0].location.quote = "imagined string";
    const p = new FakeProvider([JSON.stringify(raw)]);
    const s = await scoreArticle(GOOD_ARTICLE, p);
    expect(s.raw.findings).toHaveLength(0);
  });

  it("drops orphaned risk_flags whose finding was dropped", async () => {
    const raw = JSON.parse(buildRawWithFinding("Major"));
    raw.findings[0].location.quote = "imagined string";
    const p = new FakeProvider([JSON.stringify(raw)]);
    const s = await scoreArticle(GOOD_ARTICLE, p);
    expect(s.raw.risk_flags).toHaveLength(0);
  });

  it("extracts JSON from fenced / prose-wrapped responses", async () => {
    const p = new FakeProvider([
      `Here is my evaluation:\n\`\`\`json\n${buildPassingRaw(4)}\n\`\`\`\nthanks`,
    ]);
    const s = await scoreArticle(GOOD_ARTICLE, p);
    expect(s.computed.overall_score).toBe(80);
  });

  it("throws ArticleReviewError when no JSON is present", async () => {
    const p = new FakeProvider(["no scores here, sorry"]);
    await expect(scoreArticle(GOOD_ARTICLE, p)).rejects.toThrow(
      /no JSON object/,
    );
  });
});

describe("scoreTotal", () => {
  it("is a passthrough of the computed total (legacy API)", () => {
    expect(scoreTotal({ total: 78 })).toBe(78);
  });
});

// ---------------------------------------------------------------------------
// runScoredDraft loop.
// ---------------------------------------------------------------------------

describe("runScoredDraft", () => {
  it("accepts the first draft when it meets the bar (1 draft + 1 judge call)", async () => {
    const p = new FakeProvider([GOOD_ARTICLE, buildPassingRaw(4)]);
    const r = await runScoredDraft(INPUT, p, null, { minScore: 70 });
    expect(r.passing).toBe(true);
    expect(r.regenerated).toBe(false);
    expect(r.attempts).toHaveLength(1);
    expect(r.markdown).toContain("# t");
    expect(p.requests).toHaveLength(2);
  });

  it("regenerates below the bar, passes judge feedback into the next draft", async () => {
    const p = new FakeProvider([
      GOOD_ARTICLE,
      buildRawWithFinding("Major"), // 60 + Major finding → fail
      GOOD_ARTICLE,
      buildPassingRaw(4), // 80, passes
    ]);
    const r = await runScoredDraft(INPUT, p, null, { minScore: 70 });
    expect(r.passing).toBe(true);
    expect(r.attempts).toHaveLength(2);
    expect(p.requests).toHaveLength(4);
    const secondDraftPrompt = p.requests[2]!.messages
      .map((m) => m.content)
      .join("\n");
    expect(secondDraftPrompt).toContain("quality judge");
    expect(secondDraftPrompt).toMatch(/60\/100/);
    expect(secondDraftPrompt).toContain("acceptance bar of 70/100");
    expect(secondDraftPrompt).toContain("scene_1 — add a concrete number");
    expect(secondDraftPrompt).toContain("[Major] LOGIC_GAP");
  });

  it("a Critical finding blocks passing even when overall_score is high", async () => {
    // Critical finding ⇒ risk_flags present. The LLM put scores at 4
    // (overall 80) but the engine must mark ArticleScore.passing false.
    const raw = JSON.parse(buildRawWithFinding("Critical"));
    const p = new FakeProvider([GOOD_ARTICLE, JSON.stringify(raw)]);
    const r = await runScoredDraft(INPUT, p, null, { minScore: 70 });
    expect(r.attempts[0]!.score!.passing).toBe(false);
    expect(r.attempts[0]!.passing).toBe(false);
  });

  it("keeps the best candidate when all attempts stay below the bar", async () => {
    const p = new FakeProvider([
      GOOD_ARTICLE,
      buildPassingRaw(3), // 60
      GOOD_ARTICLE,
      buildPassingRaw(4), // 80 - best, still below 100
      GOOD_ARTICLE,
      buildPassingRaw(2), // 40
    ]);
    const r = await runScoredDraft(INPUT, p, null, { minScore: 100, maxAttempts: 3 });
    expect(r.passing).toBe(false);
    expect(r.attempts).toHaveLength(3);
    expect(r.score?.computed.overall_score).toBe(80);
  });

  it("stops iterating and accepts the draft when the judge fails", async () => {
    const p = new FakeProvider([GOOD_ARTICLE, "the judge has no opinion"]);
    const r = await runScoredDraft(INPUT, p, null, { minScore: 70 });
    expect(r.attempts).toHaveLength(1);
    expect(r.score).toBeNull();
    expect(r.passing).toBe(false);
    expect(r.markdown).toContain("# t");
  });

  it("honors maxAttempts=1 (draft once, never regenerate)", async () => {
    const p = new FakeProvider([GOOD_ARTICLE, buildPassingRaw(3)]);
    const r = await runScoredDraft(INPUT, p, null, {
      minScore: 70,
      maxAttempts: 1,
    });
    expect(r.attempts).toHaveLength(1);
    expect(p.requests).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// renderArticleReviewYaml.
// ---------------------------------------------------------------------------

describe("renderArticleReviewYaml", () => {
  it("emits per-attempt scores, findings, dimensions and a final verdict", async () => {
    const p = new FakeProvider([
      GOOD_ARTICLE,
      buildRawWithFinding("Major"),
      GOOD_ARTICLE,
      buildPassingRaw(4),
    ]);
    const r = await runScoredDraft(INPUT, p, null, { minScore: 70 });
    const yaml = renderArticleReviewYaml(r, {
      project: "demo",
      threshold: 70,
      language: "zh-CN",
    });
    expect(yaml).toContain("profile: general_article_v1");
    expect(yaml).toContain("threshold: 70");
    expect(yaml).toContain("passing: true");
    expect(yaml).toContain("attempts_used: 2");
    expect(yaml).toMatch(/final_overall: \d/);
    expect(yaml).toMatch(/final_grade: [A-F]/);
    expect(yaml).toContain("LOGIC_GAP");
    expect(yaml).toContain("scene_1 — add a concrete number");
    expect(yaml).toContain("dimensions:");
  });

  it("records judge failures without inventing a score", async () => {
    const p = new FakeProvider([GOOD_ARTICLE, "nope"]);
    const r = await runScoredDraft(INPUT, p, null, {});
    const yaml = renderArticleReviewYaml(r, {
      project: "demo",
      threshold: 70,
      language: "zh-CN",
    });
    expect(yaml).toContain("score: null");
    expect(yaml).toContain("passing: false");
    expect(yaml).toContain("final_overall: null");
  });
});

// ---------------------------------------------------------------------------
// Dimension H plumbing — the judge must see the commission, not just the
// article. Without it H always scored 0, capping the bar at 92/100 and
// making `passing: true` unreachable for every project.
// ---------------------------------------------------------------------------

describe("buildArticleReviewMessages — dimension H needs the task", () => {
  const ARTICLE = "# Title\n\nBody.";

  it("includes the commissioned task so H is assessable", () => {
    const user = buildArticleReviewMessages(ARTICLE, undefined, {
      topic: "prompt engineering to agentic engineering",
      audience: "developers",
      language: "en-US",
      durationSec: 900,
    }).find((m) => m.role === "user")!.content;
    expect(user).toContain("## Commissioned task");
    expect(user).toContain("prompt engineering to agentic engineering");
    expect(user).toContain("developers");
    expect(user).toContain("en-US");
    expect(user).toContain("900");
    expect(user).toContain("Score dimension H against THIS task");
  });

  it("tells the judge to mark H not-assessed when no task was given", () => {
    const user = buildArticleReviewMessages(ARTICLE).find(
      (m) => m.role === "user",
    )!.content;
    expect(user).toContain("not_assessed");
    expect(user).toContain("unknown");
  });

  it("runScoredDraft forwards the task to the judge on every attempt", async () => {
    const p = new FakeProvider([GOOD_ARTICLE, GOOD_ARTICLE]);
    await runScoredDraft(INPUT, p, null, { maxAttempts: 2 });
    const judges = p.requests.filter((r) =>
      r.messages.some((m) => m.role === "user" && m.content.includes("Article to judge")),
    );
    expect(judges.length).toBeGreaterThan(0);
    for (const j of judges) {
      expect(j.messages.some((m) => m.content.includes("demo"))).toBe(true);
    }
  });
});

describe("the judge must see the WHOLE article", () => {
  const user = (md: string, task?: Parameters<typeof buildArticleReviewMessages>[2]) =>
    buildArticleReviewMessages(md, undefined, task).find(
      (m) => m.role === "user",
    )!.content;

  it("passes a 36k-char article through intact", () => {
    // The rewrite that triggered this: 36,658 chars. The old 12,000 slice
    // cut it mid-word and the judge called that a Critical content gap.
    const md = "x".repeat(36658);
    const content = user(md);
    expect(content).toContain(md);
    expect(content).not.toContain("truncated for length");
  });

  it("flags the cut instead of letting the judge blame the writer", () => {
    const content = user("y".repeat(200_000));
    expect(content).toContain("truncated for length");
    expect(content).toContain("Do NOT report the cut as a structural defect");
  });
});

describe("a stray severity label must not discard the whole judgement", () => {
  it("normalizes 'Informational' onto the four-step scale", () => {
    const raw = {
      dimension_scores: [
        {
          id: "A",
          indicators: [{ id: "A1", score: 4, reason: "ok" }],
        },
      ],
      findings: [],
      risk_flags: [
        { code: "SOMETHING", severity: "Informational", finding_ids: [] },
      ],
      limitations: [],
    };
    const parsed = ArticleScoreRawSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.risk_flags[0]!.severity).toBe("Minor");
  });
});
