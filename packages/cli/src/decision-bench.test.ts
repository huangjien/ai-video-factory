import { describe, expect, it } from "vitest";
import {
  isCorrect,
  renderBenchReport,
  requestForCase,
  runDecisionBench,
  type BenchProviderSpec,
} from "./decision-bench.js";
import { listDecisionCases, type DecisionExpectation } from "@video/prompts";
import type {
  DecisionAnswer,
  DecisionProvider,
  DecisionRequest,
  DecisionValue,
} from "@video/llm";

/** A provider that answers from a lookup table. */
function fakeProvider(
  id: string,
  answer: (req: DecisionRequest) => DecisionValue,
  opts: { confidence?: number; latencyMs?: number } = {},
): BenchProviderSpec {
  const provider: DecisionProvider = {
    name: id,
    lastError: null,
    available: () => true,
    decide: async (req): Promise<DecisionAnswer | null> => ({
      value: answer(req),
      confidence: opts.confidence ?? 0.9,
      confidenceSource: "native",
      usage: { input: 10, output: 0 },
      latencyMs: opts.latencyMs ?? 100,
      provider: id,
      model: "fake",
    }),
  };
  return { id, label: id, model: "fake", make: () => provider };
}

/** A provider that answers the corpus's own expectation — the oracle
 *  the accuracy gate is measured against. */
function oracleProvider(id: string): BenchProviderSpec {
  const expected = new Map<string, DecisionExpectation>(
    listDecisionCases().map((ref) => [
      ref.fixture.state as string,
      ref.fixture.expects,
    ]),
  );
  const provider: DecisionProvider = {
    name: id,
    lastError: null,
    available: () => true,
    decide: async (req): Promise<DecisionAnswer | null> => {
      const expects =
        typeof req.state === "string" ? expected.get(req.state) : undefined;
      if (!expects) return null;
      if (expects.kind === "choice") {
        return {
          value: { kind: "choice", option: String(expects.value) },
          confidence: 0.95,
          confidenceSource: "native",
          usage: { input: 10, output: 0 },
          latencyMs: 50,
          provider: id,
          model: "oracle",
        };
      }
      if (expects.kind === "score") {
        return {
          value: { kind: "score", score: Number(expects.value), legend: {} },
          confidence: 0.95,
          confidenceSource: "native",
          usage: { input: 10, output: 0 },
          latencyMs: 50,
          provider: id,
          model: "oracle",
        };
      }
      const truth = expects.value === true || expects.value === "true";
      return {
        value: { kind: "noul", probability: truth ? 0.9 : 0.1 },
        confidence: 0.95,
        confidenceSource: "native",
        usage: { input: 10, output: 0 },
        latencyMs: 50,
        provider: id,
        model: "oracle",
      };
    },
  };
  return { id, label: id, model: "oracle", make: () => provider };
}

describe("isCorrect", () => {
  it("matches a choice exactly", () => {
    expect(isCorrect({ kind: "choice", value: "pass" }, "pass")).toBe(true);
  });

  it("rejects a different choice", () => {
    expect(isCorrect({ kind: "choice", value: "pass" }, "block")).toBe(false);
  });

  it("scores within the tolerance", () => {
    expect(isCorrect({ kind: "score", value: 2, tolerance: 0.6 }, 1.7)).toBe(true);
  });

  it("scores outside the tolerance wrong", () => {
    expect(isCorrect({ kind: "score", value: 2, tolerance: 0.6 }, 0.5)).toBe(false);
  });

  it("reads the noul side from the probability", () => {
    expect(isCorrect({ kind: "noul", value: "true" }, 0.8)).toBe(true);
    expect(isCorrect({ kind: "noul", value: "false" }, 0.8)).toBe(false);
  });
});

describe("requestForCase", () => {
  it("carries the surface's options into the question", () => {
    const ref = listDecisionCases({ surface: "qa-triage" })[0];
    const request = requestForCase(ref!);
    expect(request.question.options).toEqual(["pass", "review", "block"]);
  });

  it("carries the loaded question wording", () => {
    const ref = listDecisionCases({ surface: "qa-triage" })[0];
    const request = requestForCase(ref!);
    expect(request.question.instructions.length).toBeGreaterThan(20);
  });
});

describe("runDecisionBench", () => {
  it("scores a perfect provider at 1", async () => {
    const report = await runDecisionBench({
      providers: [oracleProvider("oracle")],
      minAccuracy: 0,
    });
    expect(report.providers[0]?.accuracy).toBe(1);
  });

  it("counts an unanswered case as wrong", async () => {
    const report = await runDecisionBench({
      providers: [
        {
          id: "silent",
          label: "silent",
          model: "fake",
          make: () => ({
            name: "silent",
            lastError: new Error("down"),
            available: () => true,
            decide: async (): Promise<DecisionAnswer | null> => null,
          }),
        },
      ],
    });
    expect(report.providers[0]?.accuracy).toBe(0);
  });

  it("marks a provider ineligible when it misses the accuracy gate", async () => {
    const report = await runDecisionBench({
      providers: [
        fakeProvider("weak", () => ({ kind: "choice", option: "pass" })),
      ],
      minAccuracy: 0.99,
    });
    expect(report.providers[0]?.eligible).toBe(false);
  });

  it("names the reason a provider is ineligible", async () => {
    const report = await runDecisionBench({
      providers: [
        fakeProvider("weak", () => ({ kind: "choice", option: "pass" })),
      ],
      minAccuracy: 0.99,
    });
    expect(report.providers[0]?.reasons.join(" ")).toContain("accuracy");
  });

  it("ranks the eligible provider first", async () => {
    const report = await runDecisionBench({
      providers: [oracleProvider("oracle"), oracleProvider("second")],
      minAccuracy: 0,
    });
    expect(report.winner).not.toBeNull();
  });

  it("leaves a provider that loses to the baseline ineligible", async () => {
    const report = await runDecisionBench({
      providers: [
        fakeProvider("weak", (req) => ({
          kind: "choice",
          option: req.question.options?.[0] ?? "",
        })),
      ],
      minAccuracy: 0,
    });
    expect(report.providers[0]?.eligible).toBe(false);
  });

  it("reports the deterministic baseline's accuracy", async () => {
    const report = await runDecisionBench({
      providers: [
        fakeProvider("a", (req) => ({
          kind: "choice",
          option: req.question.options?.[0] ?? "",
        })),
      ],
      minAccuracy: 0,
    });
    expect(report.providers[0]?.baselineAccuracy).not.toBeNull();
  });

  it("counts the disputed cases in the corpus (0 since draft-bar labels are derived)", async () => {
    const report = await runDecisionBench({
      providers: [
        fakeProvider("a", (req) => ({
          kind: "choice",
          option: req.question.options?.[0] ?? "",
        })),
      ],
      minAccuracy: 0,
    });
    // The visual-class disputed band retired with structured routing;
    // every remaining label is derived by a policy rule.
    expect(report.providers[0]?.disputed).toBe(0);
  });

  it("renders a table with one row per provider", async () => {
    const report = await runDecisionBench({
      providers: [
        fakeProvider("a", (req) => ({
          kind: "choice",
          option: req.question.options?.[0] ?? "",
        })),
      ],
      minAccuracy: 0,
    });
    expect(renderBenchReport(report)).toContain("| a | fake |");
  });
});
