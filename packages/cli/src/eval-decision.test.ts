import { describe, expect, it, vi } from "vitest";
import {
  RUBRIC_LEVELS,
  decisionRubricScores,
  rubricDecisionProvider,
  rubricScoreQuestion,
} from "./eval-decision.js";
import type { DecisionProvider, DecisionRequest } from "@video/llm";

function fakeProvider(
  answer: { score: number; confidence: number } | null = {
    score: 7.5,
    confidence: 0.8,
  },
): DecisionProvider {
  return {
    name: "fake",
    lastError: null,
    available: () => true,
    decide: async (_req: DecisionRequest) => {
      if (answer === null) return null;
      return {
        value: {
          kind: "score",
          score: answer.score,
          legend: { "7": "good" },
        },
        confidence: answer.confidence,
        confidenceSource: "native",
        usage: { input: 400, output: 0 },
        latencyMs: 11,
        provider: "fake",
        model: "fake-1",
      };
    },
    decideMany: async (req) => ({
      answers: req.questions.map(({ question }) => ({
        questionId: question.id,
        answer:
          answer === null
            ? null
            : {
                value: {
                  kind: "score",
                  score: answer.score,
                  legend: { "7": "good" },
                },
                confidence: answer.confidence,
                confidenceSource: "native",
                usage: { input: 0, output: 0 },
                latencyMs: 11,
                provider: "fake",
                model: "fake-1",
              },
        error: answer === null ? "offline" : null,
      })),
      provider: "fake",
      model: "fake-1",
      usage: { input: 400, output: 0 },
      latencyMs: 11,
    }),
  };
}

describe("rubricScoreQuestion", () => {
  it("is a score question with levels 0 to 10", () => {
    const q = rubricScoreQuestion("draft", "structure");
    expect(q.kind).toBe("score");
    expect(q.levels).toEqual(RUBRIC_LEVELS);
    expect(q.levels?.length).toBe(11);
  });

  it("names the agent and the axis", () => {
    const q = rubricScoreQuestion("draft", "structure");
    expect(q.id).toBe("eval-rubric:draft:structure");
    expect(q.instructions).toContain("structure");
  });
});

describe("decisionRubricScores", () => {
  it("returns one score per axis", async () => {
    const provider = fakeProvider();
    const batchSpy = vi.spyOn(provider, "decideMany");
    const out = await decisionRubricScores({
      agent: "draft",
      axes: ["structure", "accuracy"],
      output: "the output",
      provider,
    });
    expect(out.map((s) => s.axis)).toEqual(["structure", "accuracy"]);
    expect(out[0]?.score).toBe(7.5);
    expect(out[0]?.confidence).toBe(0.8);
    expect(batchSpy).toHaveBeenCalledTimes(1);
  });

  it("records the error instead of throwing when the provider fails", async () => {
    const out = await decisionRubricScores({
      agent: "draft",
      axes: ["structure"],
      output: "the output",
      provider: fakeProvider(null),
    });
    expect(out[0]?.score).toBeNull();
    expect(out[0]?.error).toBeTruthy();
  });
});

describe("rubricDecisionProvider", () => {
  it("is null when the layer is off", () => {
    expect(rubricDecisionProvider({ DECISION_MODE: "off" })).toBeNull();
  });

  it("is null when no provider has a key", () => {
    const key = process.env["OPENAI_API_KEY"];
    const geminiKey = process.env["GEMINI_API_KEY"];
    const minimaxKey = process.env["MINIMAX_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["GEMINI_API_KEY"];
    delete process.env["MINIMAX_API_KEY"];
    try {
      const env = { DECISION_MODE: "on" } as NodeJS.ProcessEnv;
      expect(rubricDecisionProvider(env)).toBeNull();
    } finally {
      if (key !== undefined) process.env["OPENAI_API_KEY"] = key;
      if (geminiKey !== undefined) process.env["GEMINI_API_KEY"] = geminiKey;
      if (minimaxKey !== undefined) {
        process.env["MINIMAX_API_KEY"] = minimaxKey;
      }
    }
  });
});
