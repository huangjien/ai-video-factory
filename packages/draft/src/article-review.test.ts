import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";
import {
  ArticleScoreSchema,
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

function judgeScore(a: number, i: number, u: number, suggestions: string[] = []) {
  return JSON.stringify({
    attractive: a,
    interesting: i,
    useful: u,
    comment: "needs work",
    suggestions,
  });
}

const INPUT = {
  topic: "demo",
  audience: "developers",
  language: "zh-CN" as const,
  duration: 60,
};

describe("ArticleScoreSchema", () => {
  it("coerces floats and clamps to 0-10", () => {
    const s = ArticleScoreSchema.parse({
      attractive: 8.4,
      interesting: 12,
      useful: -1,
    });
    expect(s.attractive).toBe(8);
    expect(s.interesting).toBe(10);
    expect(s.useful).toBe(0);
    expect(s.suggestions).toEqual([]);
  });

  it("rejects non-numeric axes", () => {
    expect(
      ArticleScoreSchema.safeParse({ attractive: "high", interesting: 1, useful: 2 })
        .success,
    ).toBe(false);
  });

  it("scoreTotal sums the three axes", () => {
    expect(scoreTotal({ attractive: 8, interesting: 7, useful: 9 })).toBe(24);
  });
});

describe("scoreArticle", () => {
  it("parses a clean JSON judge response", async () => {
    const p = new FakeProvider([judgeScore(9, 8, 9)]);
    const s = await scoreArticle("ARTICLE", p);
    expect(s.total).toBe(26);
    expect(s.comment).toBe("needs work");
  });

  it("extracts JSON from fenced / prose-wrapped responses", async () => {
    const p = new FakeProvider([
      `Here is my evaluation:\n\`\`\`json\n${judgeScore(7, 7, 7)}\n\`\`\`\nthanks`,
    ]);
    const s = await scoreArticle("ARTICLE", p);
    expect(s.total).toBe(21);
  });

  it("throws ArticleReviewError when no JSON is present", async () => {
    const p = new FakeProvider(["no scores here, sorry"]);
    await expect(scoreArticle("ARTICLE", p)).rejects.toThrow(
      /no JSON object/,
    );
  });
});

describe("runScoredDraft", () => {
  it("accepts the first draft when it meets the bar (1 draft + 1 judge call)", async () => {
    const p = new FakeProvider([GOOD_ARTICLE, judgeScore(9, 9, 8)]);
    const r = await runScoredDraft(INPUT, p, null, { minScore: 25 });
    expect(r.passing).toBe(true);
    expect(r.regenerated).toBe(false);
    expect(r.attempts).toHaveLength(1);
    expect(r.markdown).toContain("# t");
    expect(p.requests).toHaveLength(2);
  });

  it("regenerates below the bar, passes judge feedback into the next draft", async () => {
    const p = new FakeProvider([
      GOOD_ARTICLE,
      judgeScore(6, 7, 8, ["scene_1 narration is flat — add a concrete anecdote"]),
      GOOD_ARTICLE,
      judgeScore(9, 9, 8),
    ]);
    const r = await runScoredDraft(INPUT, p, null, { minScore: 25 });
    expect(r.passing).toBe(true);
    expect(r.attempts).toHaveLength(2);
    expect(p.requests).toHaveLength(4);
    const secondDraftPrompt = p.requests[2]!.messages
      .map((m) => m.content)
      .join("\n");
    expect(secondDraftPrompt).toContain("quality judge");
    expect(secondDraftPrompt).toContain("attractive=6");
    expect(secondDraftPrompt).toContain("add a concrete anecdote");
  });

  it("keeps the best candidate when all attempts stay below the bar", async () => {
    const p = new FakeProvider([
      GOOD_ARTICLE,
      judgeScore(6, 6, 6), // 18
      GOOD_ARTICLE,
      judgeScore(9, 8, 7), // 24 — best, still below 25
      GOOD_ARTICLE,
      judgeScore(5, 5, 5), // 15
    ]);
    const r = await runScoredDraft(INPUT, p, null, { minScore: 25 });
    expect(r.passing).toBe(false);
    expect(r.attempts).toHaveLength(3);
    expect(r.score?.total).toBe(24);
    expect(r.markdown).toContain("# t");
  });

  it("stops iterating and accepts the draft when the judge fails", async () => {
    const p = new FakeProvider([GOOD_ARTICLE, "the judge has no opinion"]);
    const r = await runScoredDraft(INPUT, p, null, { minScore: 25 });
    expect(r.attempts).toHaveLength(1);
    expect(r.score).toBeNull();
    expect(r.passing).toBe(false);
    expect(r.markdown).toContain("# t");
  });

  it("honors maxAttempts=1 (draft once, never regenerate)", async () => {
    const p = new FakeProvider([GOOD_ARTICLE, judgeScore(3, 3, 3)]);
    const r = await runScoredDraft(INPUT, p, null, { minScore: 25, maxAttempts: 1 });
    expect(r.attempts).toHaveLength(1);
    expect(p.requests).toHaveLength(2);
  });
});

describe("renderArticleReviewYaml", () => {
  it("emits per-attempt scores and a final verdict", async () => {
    const p = new FakeProvider([
      GOOD_ARTICLE,
      judgeScore(6, 7, 8, ["fix a", "fix b"]),
      GOOD_ARTICLE,
      judgeScore(9, 9, 8),
    ]);
    const r = await runScoredDraft(INPUT, p, null, { minScore: 25 });
    const yaml = renderArticleReviewYaml(r, {
      project: "demo",
      threshold: 25,
      language: "zh-CN",
    });
    expect(yaml).toContain("threshold: 25");
    expect(yaml).toContain("passing: true");
    expect(yaml).toContain("attempts_used: 2");
    expect(yaml).toContain("final_total: 26");
    expect(yaml).toContain("- fix a");
    expect(yaml).toContain("attractive: 6");
    expect(yaml).toContain("attractive: 9");
  });

  it("records judge failures without inventing a score", async () => {
    const p = new FakeProvider([GOOD_ARTICLE, "nope"]);
    const r = await runScoredDraft(INPUT, p, null, {});
    const yaml = renderArticleReviewYaml(r, {
      project: "demo",
      threshold: 25,
      language: "zh-CN",
    });
    expect(yaml).toContain("score: null");
    expect(yaml).toContain("passing: false");
    expect(yaml).toContain("final_total: null");
  });
});
