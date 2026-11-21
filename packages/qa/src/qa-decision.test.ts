import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildQaState,
  qaDecisionQuestion,
  qaFindingBaseline,
  runQaDecisionAdvisory,
  type QaDecisionRow,
} from "./qa-decision.js";
import { createDecisionProvider } from "@video/llm";
import type { QaFinding, RenderReport } from "./index.js";
import type { DecisionProvider, DecisionRequest } from "@video/llm";

const finding: QaFinding = {
  level: "warn",
  check: "sceneBoundaries",
  message:
    "only 7/20 expected scene cuts detected (transitions and slow scenes blur pixel deltas)",
  fix: "Check qa/contact-sheet.png; verify per-scene durations in the storyboard.",
};

function report(findings: QaFinding[]): RenderReport {
  return {
    video: "/tmp/preview.mp4",
    generatedAt: "2026-11-14T00:00:00.000Z",
    ok: findings.every((f) => f.level !== "error"),
    findings,
    checks: {} as RenderReport["checks"],
  };
}

/** A provider that always answers `block`. */
function fakeProvider(answer: string | null = "block"): DecisionProvider {
  return {
    name: "fake",
    lastError: null,
    available: () => true,
    decide: async (req: DecisionRequest) => {
      if (answer === null) return null;
      return {
        value: { kind: "choice", option: answer },
        confidence: 0.82,
        confidenceSource: "native",
        usage: { input: 100, output: 0 },
        latencyMs: 5,
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
                value: { kind: "choice", option: answer },
                confidence: 0.82,
                confidenceSource: "native",
                usage: { input: 0, output: 0 },
                latencyMs: 5,
                provider: "fake",
                model: "fake-1",
              },
        error: answer === null ? "offline" : null,
      })),
      provider: "fake",
      model: "fake-1",
      usage: { input: 100, output: 0 },
      latencyMs: 5,
    }),
  };
}

describe("qaFindingBaseline", () => {
  it("maps an error finding to block", () => {
    expect(qaFindingBaseline("error")).toBe("block");
  });

  it("maps a warn finding to review", () => {
    expect(qaFindingBaseline("warn")).toBe("review");
  });
});

describe("buildQaState", () => {
  it("matches the corpus's level · check · message format", () => {
    const state = buildQaState(finding);
    expect(state).toContain(
      "warn · sceneBoundaries · only 7/20 expected scene cuts detected",
    );
  });

  it("carries the fix line", () => {
    expect(buildQaState(finding)).toContain("fix: Check qa/contact-sheet.png");
  });

  it("omits the fix line when there is none", () => {
    const state = buildQaState({ level: "warn", check: "audio", message: "m" });
    expect(state).not.toContain("fix:");
  });
});

describe("qaDecisionQuestion", () => {
  it("offers the three verdicts", () => {
    expect(qaDecisionQuestion().options).toEqual(["pass", "review", "block"]);
  });
});

describe("runQaDecisionAdvisory", () => {
  it("does nothing in off mode", async () => {
    const out = await runQaDecisionAdvisory({
      project: "demo",
      report: report([finding]),
      mode: "off",
      provider: fakeProvider(),
    });
    expect(out.consulted).toBe(0);
  });

  it("does nothing on a report with no findings", async () => {
    const out = await runQaDecisionAdvisory({
      project: "demo",
      report: report([]),
      mode: "shadow",
      provider: fakeProvider(),
    });
    expect(out.consulted).toBe(0);
  });

  it("attaches the advisory to the finding", async () => {
    const provider = fakeProvider("block");
    const batchSpy = vi.spyOn(provider, "decideMany");
    const out = await runQaDecisionAdvisory({
      project: "demo",
      report: report([finding]),
      mode: "shadow",
      provider,
    });
    expect(out.report.findings[0]?.advisory).toBe("block");
    expect(batchSpy).toHaveBeenCalledTimes(1);
  });

  it("records the confidence on the finding", async () => {
    const out = await runQaDecisionAdvisory({
      project: "demo",
      report: report([finding]),
      mode: "shadow",
      provider: fakeProvider("block"),
    });
    expect(out.report.findings[0]?.advisory_confidence).toBeCloseTo(0.82, 5);
  });

  it("computes agreement against the check's own level", async () => {
    // warn → baseline review; the fake answers block → disagreement.
    const out = await runQaDecisionAdvisory({
      project: "demo",
      report: report([finding]),
      mode: "shadow",
      provider: fakeProvider("block"),
    });
    expect(out.agreed).toBe(0);
  });

  it("marks agreement when the answer matches the level rule", async () => {
    const out = await runQaDecisionAdvisory({
      project: "demo",
      report: report([finding]),
      mode: "shadow",
      provider: fakeProvider("review"),
    });
    expect(out.agreed).toBe(1);
  });

  it("does not mutate the caller's report", async () => {
    const original = report([finding]);
    await runQaDecisionAdvisory({
      project: "demo",
      report: original,
      mode: "shadow",
      provider: fakeProvider("block"),
    });
    expect(original.findings[0]?.advisory).toBeUndefined();
  });

  it("appends one log row per finding", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "qa-advisory-"));
    const logPath = path.join(dir, "decision-log.jsonl");
    await runQaDecisionAdvisory({
      project: "demo",
      report: report([finding]),
      mode: "shadow",
      provider: fakeProvider(),
      logPath,
    });
    const body = await readFile(logPath, "utf8");
    const rows = body
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as QaDecisionRow);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.surface).toBe("qa-triage");
    expect(rows[0]?.baseline).toBe("review");
  });

  it("never writes the raw state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "qa-advisory-"));
    const logPath = path.join(dir, "decision-log.jsonl");
    await runQaDecisionAdvisory({
      project: "demo",
      report: report([finding]),
      mode: "shadow",
      provider: fakeProvider(),
      logPath,
    });
    const body = await readFile(logPath, "utf8");
    expect(body).not.toContain("scene cuts");
  });

  it("attaches no advisory when the provider answers nothing", async () => {
    const out = await runQaDecisionAdvisory({
      project: "demo",
      report: report([finding]),
      mode: "shadow",
      provider: fakeProvider(null),
    });
    expect(out.report.findings[0]?.advisory).toBeUndefined();
  });

  it("skips cleanly when NO provider has a key", async () => {
    const key = process.env["OPENAI_API_KEY"];
    const geminiKey = process.env["GEMINI_API_KEY"];
    const minimaxKey = process.env["MINIMAX_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["GEMINI_API_KEY"];
    delete process.env["MINIMAX_API_KEY"];
    const seen: string[] = [];
    const original = console.error;
    console.error = (message: string) => seen.push(message);
    try {
      const out = await runQaDecisionAdvisory({
        project: "demo",
        report: report([finding]),
        mode: "shadow",
      });
      expect(out.consulted).toBe(0);
      expect(seen.some((m) => m.includes("key not set"))).toBe(true);
    } finally {
      console.error = original;
      if (key !== undefined) process.env["OPENAI_API_KEY"] = key;
      if (geminiKey !== undefined) process.env["GEMINI_API_KEY"] = geminiKey;
      if (minimaxKey !== undefined) {
        process.env["MINIMAX_API_KEY"] = minimaxKey;
      }
    }
  });

  it("skips when the configured provider chain has no keys", async () => {
    const key = process.env["OPENAI_API_KEY"];
    const geminiKey = process.env["GEMINI_API_KEY"];
    const minimaxKey = process.env["MINIMAX_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["GEMINI_API_KEY"];
    delete process.env["MINIMAX_API_KEY"];
    try {
      const out = await runQaDecisionAdvisory({
        project: "demo",
        report: report([finding]),
        mode: "shadow",
        provider: createDecisionProvider({ provider: "auto" }),
      });
      expect(out.consulted).toBe(0);
    } finally {
      if (key !== undefined) process.env["OPENAI_API_KEY"] = key;
      if (geminiKey !== undefined) process.env["GEMINI_API_KEY"] = geminiKey;
      if (minimaxKey !== undefined) process.env["MINIMAX_API_KEY"] = minimaxKey;
    }
  });
});
