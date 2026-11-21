import { describe, expect, it } from "vitest";
import {
  createDecisionProvider,
  FallbackDecisionProvider,
  isQuotaError,
} from "./runtime.js";
import type {
  DecisionAnswer,
  DecisionProvider,
  DecisionInputModality,
  DecisionRequest,
} from "./contract.js";

const request: DecisionRequest = {
  state: "a state",
  question: {
    id: "q",
    kind: "choice",
    instructions: "choose one",
    options: ["a", "b"],
  },
};

/** A provider that answers, or fails, on demand. */
function fakeProvider(opts: {
  name: string;
  answer?: string | null;
  error?: string | null;
  available?: boolean;
  modalities?: DecisionInputModality[];
}): DecisionProvider {
  const provider: DecisionProvider = {
    name: opts.name,
    supportedModalities: opts.modalities ?? ["text"],
    lastError: null,
    available: () => opts.available !== false,
    decide: async (): Promise<DecisionAnswer | null> => {
      if (opts.error !== undefined && opts.error !== null) {
        provider.lastError = new Error(opts.error);
        return null;
      }
      if (opts.answer === null) {
        // Answered, but the answer was unusable — no error recorded.
        return null;
      }
      return {
        value: { kind: "choice", option: opts.answer ?? "a" },
        confidence: 0.9,
        confidenceSource: "native",
        usage: { input: 10, output: 0 },
        latencyMs: 5,
        provider: opts.name,
        model: `${opts.name}-1`,
      };
    },
    decideMany: async (req) => {
      const result = await provider.decide(reqToLegacy(req));
      return {
        answers: req.questions.map(({ question }) => ({
          questionId: question.id,
          answer: result,
          error: result ? null : (provider.lastError?.message ?? "no answer"),
        })),
        provider: result?.provider ?? opts.name,
        model: result?.model ?? "",
        usage: result?.usage ?? { input: 0, output: 0 },
        latencyMs: result?.latencyMs ?? 0,
      };
    },
  };
  return provider;
}

function reqToLegacy(
  req: import("./contract.js").DecisionBatchRequest,
): DecisionRequest {
  const first = req.questions[0]!;
  return {
    state: req.input
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n"),
    question: first.question,
    ...(first.minConfidence !== undefined
      ? { minConfidence: first.minConfidence }
      : {}),
  };
}

describe("FallbackDecisionProvider", () => {
  it("recognizes Google resource exhaustion as a quota failure", () => {
    expect(
      isQuotaError("RESOURCE_EXHAUSTED: prepayment credits depleted"),
    ).toBe(true);
  });

  it("selects Google explicitly and makes it the first auto provider", () => {
    const provider = createDecisionProvider({
      provider: "google",
      model: "gemini-decision-1",
    });
    expect(provider.name).toBe("google");
    const automatic = createDecisionProvider();
    expect(automatic.name).toBe("google→openai→minimax");
  });

  it("names the chain", () => {
    const chain = new FallbackDecisionProvider([
      fakeProvider({ name: "openai", answer: "a" }),
      fakeProvider({ name: "minimax", answer: "b" }),
    ]);
    expect(chain.name).toBe("openai→minimax");
  });

  it("uses the primary when it answers", async () => {
    const chain = new FallbackDecisionProvider([
      fakeProvider({ name: "openai", answer: "a" }),
      fakeProvider({ name: "minimax", answer: "b" }),
    ]);
    const answer = await chain.decide(request);
    expect(answer?.provider).toBe("openai");
  });

  it("skips providers that cannot represent the batch input", async () => {
    const chain = new FallbackDecisionProvider([
      fakeProvider({ name: "openai", answer: "a", modalities: ["text"] }),
      fakeProvider({ name: "google", answer: "b", modalities: ["image"] }),
    ]);
    const result = await chain.decideMany({
      input: [
        { type: "image", mimeType: "image/png", data: new Uint8Array([1]) },
      ],
      questions: [{ question: request.question }],
    });
    expect(result.answers[0]?.answer?.value).toEqual({
      kind: "choice",
      option: "b",
    });
    expect(result.provider).toBe("google");
  });

  it("retries the whole batch after a service error, even if the failed batch was partial", async () => {
    const partial: DecisionProvider = {
      name: "google",
      supportedModalities: ["text"],
      lastError: null,
      available: () => true,
      async decide() {
        return null;
      },
      async decideMany(req) {
        this.lastError = new Error("503 unavailable");
        const partialAnswer: DecisionAnswer = {
          value: { kind: "choice", option: "a" },
          confidence: 0.9,
          confidenceSource: "native",
          usage: { input: 0, output: 0 },
          latencyMs: 2,
          provider: "google",
          model: "decision-1",
        };
        return {
          answers: req.questions.map(({ question }, index) => ({
            questionId: question.id,
            answer: index === 0 ? partialAnswer : null,
            error: index === 0 ? null : "service unavailable",
          })),
          provider: "google",
          model: "decision-1",
          usage: { input: 10, output: 0 },
          latencyMs: 2,
        };
      },
    };
    const chain = new FallbackDecisionProvider([
      partial,
      fakeProvider({ name: "openai", answer: "b" }),
    ]);
    const result = await chain.decideMany({
      input: [{ type: "text", text: "state" }],
      questions: [
        { question: request.question },
        { question: { ...request.question, id: "q2" } },
      ],
    });
    expect(result.provider).toBe("openai");
    expect(
      result.answers.every(
        (item) =>
          item.answer?.value.kind === "choice" &&
          item.answer.value.option === "b",
      ),
    ).toBe(true);
  });

  it("falls back when the primary fails with an error", async () => {
    const chain = new FallbackDecisionProvider([
      fakeProvider({ name: "openai", error: "429 quota exhausted" }),
      fakeProvider({ name: "minimax", answer: "b" }),
    ]);
    const answer = await chain.decide(request);
    expect(answer?.provider).toBe("minimax");
  });

  it("does NOT fall back when the primary answered with an unusable answer", async () => {
    // No error recorded → a quality signal, not an outage. Falling back
    // would hide it behind a better-looking answer and spend a call.
    const chain = new FallbackDecisionProvider([
      fakeProvider({ name: "openai", answer: null }),
      fakeProvider({ name: "minimax", answer: "b" }),
    ]);
    const answer = await chain.decide(request);
    expect(answer).toBeNull();
  });

  it("skips a provider without a key", async () => {
    const chain = new FallbackDecisionProvider([
      fakeProvider({ name: "openai", available: false, answer: "a" }),
      fakeProvider({ name: "minimax", answer: "b" }),
    ]);
    const answer = await chain.decide(request);
    expect(answer?.provider).toBe("minimax");
  });

  it("is available when at least one provider is", () => {
    const chain = new FallbackDecisionProvider([
      fakeProvider({ name: "openai", available: false }),
      fakeProvider({ name: "minimax", available: true }),
    ]);
    expect(chain.available()).toBe(true);
  });

  it("is unavailable when no provider is", () => {
    const chain = new FallbackDecisionProvider([
      fakeProvider({ name: "openai", available: false }),
      fakeProvider({ name: "minimax", available: false }),
    ]);
    expect(chain.available()).toBe(false);
  });

  it("keeps the last failure as its error", async () => {
    const chain = new FallbackDecisionProvider([
      fakeProvider({ name: "openai", error: "429 quota exhausted" }),
      fakeProvider({ name: "minimax", error: "2056 plan limit" }),
    ]);
    const answer = await chain.decide(request);
    expect(answer).toBeNull();
    expect(chain.lastError?.message).toContain("2056");
  });

  it("rejects an empty chain", () => {
    expect(() => new FallbackDecisionProvider([])).toThrow(/at least one/);
  });
});
