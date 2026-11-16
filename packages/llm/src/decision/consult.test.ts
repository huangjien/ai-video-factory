import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendDecisionRows,
  consultDecision,
  valueToString,
} from "./consult.js";
import type {
  DecisionAnswer,
  DecisionProvider,
  DecisionValue,
} from "./contract.js";

/** A provider that answers with whatever the test hands it. */
function fakeProvider(
  answer: DecisionAnswer | null,
  opts: { lastError?: Error | null; throws?: Error | null } = {},
): DecisionProvider {
  return {
    name: "fake",
    available: () => true,
    lastError: opts.lastError ?? null,
    async decide(): Promise<DecisionAnswer | null> {
      if (opts.throws) throw opts.throws;
      return answer;
    },
  };
}

function choiceAnswer(option: string): DecisionAnswer {
  return {
    value: { kind: "choice", option, probabilities: { [option]: 0.9 } },
    confidence: 0.72,
    confidenceSource: "native",
    usage: { input: 100, output: 0 },
    latencyMs: 42,
    provider: "openai",
    model: "gpt-6-luna",
  };
}

const question = {
  id: "test",
  kind: "choice" as const,
  instructions: "Which one?",
  options: ["a", "b"],
};

describe("consultDecision", () => {
  it("flattens a choice answer to its option", async () => {
    const r = await consultDecision({
      provider: fakeProvider(choiceAnswer("b")),
      question,
      state: "s",
    });
    expect(r.answer).toBe("b");
    expect(r.confidence).toBe(0.72);
    expect(r.confidenceSource).toBe("native");
    expect(r.provider).toBe("openai");
    expect(r.model).toBe("gpt-6-luna");
    expect(r.error).toBeNull();
  });

  it("flattens a score answer to its number", async () => {
    const answer: DecisionAnswer = {
      ...choiceAnswer("b"),
      value: { kind: "score", score: 7.5, legend: { "7": "good" } },
    };
    const r = await consultDecision({
      provider: fakeProvider(answer),
      question: { ...question, kind: "score", levels: ["bad", "good"] },
      state: "s",
    });
    expect(r.answer).toBe("7.5");
  });

  it("flattens a noul answer to its probability", async () => {
    const answer: DecisionAnswer = {
      ...choiceAnswer("b"),
      value: { kind: "noul", probability: 0.83 },
    };
    const r = await consultDecision({
      provider: fakeProvider(answer),
      question: { ...question, kind: "noul" },
      state: "s",
    });
    expect(r.answer).toBe("0.83");
  });

  it("never throws when the provider throws", async () => {
    const r = await consultDecision({
      provider: fakeProvider(null, { throws: new Error("boom") }),
      question,
      state: "s",
    });
    expect(r.answer).toBeNull();
    expect(r.error).toBe("boom");
  });

  it("records the provider's last error when the answer is null", async () => {
    const r = await consultDecision({
      provider: fakeProvider(null, { lastError: new Error("429 quota") }),
      question,
      state: "s",
    });
    expect(r.answer).toBeNull();
    expect(r.error).toBe("429 quota");
  });

  it("names the provider that served the call", async () => {
    // A fallback chain answers with the provider that actually ran, so a
    // fallback run is visible in the corpus instead of being averaged
    // into the primary's score.
    const chain: DecisionProvider = {
      name: "openai→minimax",
      available: () => true,
      lastError: null,
      async decide(): Promise<DecisionAnswer | null> {
        return { ...choiceAnswer("a"), provider: "minimax" };
      },
    };
    const r = await consultDecision({ provider: chain, question, state: "s" });
    expect(r.provider).toBe("minimax");
  });
});

describe("valueToString", () => {
  it("renders each kind of value", () => {
    const values: DecisionValue[] = [
      { kind: "choice", option: "keep" },
      { kind: "score", score: 3, legend: {} },
      { kind: "noul", probability: 0.25 },
    ];
    expect(values.map(valueToString)).toEqual(["keep", "3", "0.25"]);
  });
});

describe("appendDecisionRows", () => {
  it("writes one JSON object per line", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "decision-log-"));
    const file = path.join(dir, "decision-log.jsonl");
    await appendDecisionRows(file, [{ surface: "x", answer: "a" }]);
    await appendDecisionRows(file, [{ surface: "y", answer: "b" }]);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!)).toEqual({ surface: "x", answer: "a" });
  });

  it("writes nothing when there are no rows", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "decision-log-"));
    const file = path.join(dir, "decision-log.jsonl");
    await appendDecisionRows(file, []);
    expect(() => readFileSync(file, "utf8")).toThrow();
  });

  it("prints one line and does not throw when the log cannot be written", async () => {
    // A log that cannot be written must never fail a render.
    await expect(
      appendDecisionRows("/definitely/not/a/writable/path.jsonl", [
        { surface: "x" },
      ]),
    ).resolves.toBeUndefined();
  });
});
