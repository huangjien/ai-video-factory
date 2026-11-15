import { describe, expect, it } from "vitest";
import { FallbackDecisionProvider } from "./runtime.js";
import type { DecisionAnswer, DecisionProvider, DecisionRequest } from "./contract.js";

const request: DecisionRequest = {
  state: "a state",
  question: { id: "q", kind: "choice", instructions: "pick", options: ["a", "b"] },
};

/** A provider that answers, or fails, on demand. */
function fakeProvider(opts: {
  name: string;
  answer?: string | null;
  error?: string | null;
  available?: boolean;
}): DecisionProvider {
  const provider: DecisionProvider = {
    name: opts.name,
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
  };
  return provider;
}

describe("FallbackDecisionProvider", () => {
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
