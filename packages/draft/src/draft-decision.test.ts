import { describe, expect, it } from "vitest";
import {
  buildDraftBarState,
  consultDraftDecision,
  draftBarDecisionQuestion,
  harvestDraftBarCandidates,
  verdictFactsFromAttempt,
  type DraftBarAttemptFacts,
  type DraftDecisionRow,
} from "./draft-decision.js";
import type {
  DecisionAnswer,
  DecisionProvider,
  DecisionRequest,
} from "@video/llm";

const attempt: DraftBarAttemptFacts = {
  attempt: 4,
  overall: 71.2,
  grade: "C",
  passing: false,
  findings: [
    {
      id: "F-001",
      code: "CONTENT_GAP",
      severity: "Major",
      description: "The promotion path is compressed into three words.",
    },
    {
      id: "F-002",
      code: "LOGIC_OVERGENERALIZATION",
      severity: "Moderate",
      description: "Five motives are stated as the real reasons.",
    },
  ],
  risk_flags: [
    { code: "MAJOR_REVISION_NEEDED", severity: "Major" },
    { code: "FACTS_NOT_EXTERNALLY_VERIFIED", severity: "Moderate" },
  ],
};

/** A provider that always answers `reject`. */
function fakeProvider(answer: string | null = "reject"): DecisionProvider {
  return {
    name: "fake",
    lastError: null,
    available: () => true,
    decide: async (req: DecisionRequest): Promise<DecisionAnswer | null> => {
      if (answer === null) return null;
      return {
        value: { kind: "choice", option: answer },
        confidence: 0.8,
        confidenceSource: "native",
        usage: { input: 50, output: 0 },
        latencyMs: 5,
        provider: "fake",
        model: "fake-1",
      };
    },
  };
}

describe("verdictFactsFromAttempt", () => {
  it("reads a passing attempt", () => {
    expect(verdictFactsFromAttempt({ attempt: 1, passing: true })).toEqual({
      passing: true,
    });
  });

  it("reads a Critical finding", () => {
    const facts = verdictFactsFromAttempt({
      attempt: 1,
      passing: false,
      findings: [{ severity: "Critical" }],
    });
    expect(facts.critical).toBe(true);
  });

  it("reads a CRITICAL_BLOCKER risk flag", () => {
    const facts = verdictFactsFromAttempt({
      attempt: 1,
      passing: false,
      risk_flags: [{ code: "CRITICAL_BLOCKER" }],
    });
    expect(facts.critical).toBe(true);
  });

  it("reads a MAJOR_REVISION_NEEDED flag", () => {
    const facts = verdictFactsFromAttempt({
      attempt: 1,
      passing: false,
      risk_flags: [{ code: "MAJOR_REVISION_NEEDED" }],
    });
    expect(facts.major_revision_needed).toBe(true);
  });
});

describe("buildDraftBarState", () => {
  it("names the project", () => {
    expect(buildDraftBarState("努力", attempt)).toContain("A draft about 努力");
  });

  it("carries each finding with its severity and code", () => {
    const state = buildDraftBarState("努力", attempt);
    expect(state).toContain("F-001 (Major, CONTENT_GAP)");
  });

  it("carries the verdict", () => {
    expect(buildDraftBarState("努力", attempt)).toContain(
      "Overall 71.2, grade C, passing false",
    );
  });

  it("carries the risk flags", () => {
    expect(buildDraftBarState("努力", attempt)).toContain(
      "MAJOR_REVISION_NEEDED (Major)",
    );
  });

  it("says so when there are no findings", () => {
    expect(
      buildDraftBarState("demo", { attempt: 1, passing: true }),
    ).toContain("No findings.");
  });
});

describe("draftBarDecisionQuestion", () => {
  it("offers the three verdicts", () => {
    expect(draftBarDecisionQuestion(1).options).toEqual([
      "pass",
      "revise",
      "reject",
    ]);
  });
});

describe("consultDraftDecision", () => {
  it("records the review's derived label", async () => {
    const row = await consultDraftDecision({
      project: "努力",
      attempt,
      provider: fakeProvider(),
      mode: "shadow",
    });
    expect(row.label).toBe("revise");
  });

  it("marks a disagreement with the review's verdict", async () => {
    const row = await consultDraftDecision({
      project: "努力",
      attempt,
      provider: fakeProvider("reject"),
      mode: "shadow",
    });
    expect(row.agreed).toBe(false);
  });

  it("records the decision's answer", async () => {
    const row = await consultDraftDecision({
      project: "努力",
      attempt,
      provider: fakeProvider("revise"),
      mode: "shadow",
    });
    expect(row.answer).toBe("revise");
  });

  it("records the attempt it is about", async () => {
    const row = await consultDraftDecision({
      project: "努力",
      attempt,
      provider: fakeProvider(),
      mode: "shadow",
    });
    expect(row.attempt).toBe(4);
  });

  it("never writes the raw state", async () => {
    const row = await consultDraftDecision({
      project: "努力",
      attempt,
      provider: fakeProvider(),
      mode: "shadow",
    });
    expect(row.state_sha256).toHaveLength(64);
  });

  it("records an unanswered consult as an error", async () => {
    const row = await consultDraftDecision({
      project: "努力",
      attempt,
      provider: fakeProvider(null),
      mode: "shadow",
    });
    expect(row.answer).toBeNull();
  });
});

describe("harvestDraftBarCandidates", () => {
  const row: DraftDecisionRow = {
    ts: "2026-11-14T00:00:00.000Z",
    surface: "draft-bar",
    project: "努力",
    attempt: 4,
    mode: "shadow",
    provider: "openai",
    model: "gpt-6-luna",
    state_sha256: "abc",
    answer: "reject",
    confidence: 0.66,
    confidence_source: "native",
    verdict: { passing: false, major_revision_needed: true },
    label: "revise",
    agreed: false,
    latency_ms: 300,
    usage: { input: 900, output: 0 },
    error: null,
  };

  it("produces a candidate per attempt", () => {
    const candidates = harvestDraftBarCandidates({
      rows: [row],
      attempts: [attempt],
      project: "努力",
    });
    expect(candidates).toHaveLength(1);
  });

  it("derives the label from the verdict, not from the model", () => {
    const candidates = harvestDraftBarCandidates({
      rows: [row],
      attempts: [attempt],
      project: "努力",
    });
    expect(candidates[0]?.expects.value).toBe("revise");
  });

  it("does not mark a derived label disputed", () => {
    const candidates = harvestDraftBarCandidates({
      rows: [row],
      attempts: [attempt],
      project: "努力",
    });
    expect(candidates[0]?.disputed).toBe(false);
  });

  it("carries the verdict facts the label was derived from", () => {
    const candidates = harvestDraftBarCandidates({
      rows: [row],
      attempts: [attempt],
      project: "努力",
    });
    expect(candidates[0]?.source_verdict?.major_revision_needed).toBe(true);
  });

  it("rebuilds the state from the artifact", () => {
    const candidates = harvestDraftBarCandidates({
      rows: [row],
      attempts: [attempt],
      project: "努力",
    });
    expect(candidates[0]?.state).toBe(buildDraftBarState("努力", attempt));
  });

  it("records the model's disagreement in the policy note", () => {
    const candidates = harvestDraftBarCandidates({
      rows: [row],
      attempts: [attempt],
      project: "努力",
    });
    expect(candidates[0]?.policy.note).toContain("DISAGREED");
  });

  it("skips a row whose attempt is gone", () => {
    const candidates = harvestDraftBarCandidates({
      rows: [row],
      attempts: [],
      project: "努力",
    });
    expect(candidates).toHaveLength(0);
  });
});
