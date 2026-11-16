import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildReviewVerdictState,
  consultReviewVerdict,
  reviewSectionFacts,
  reviewVerdictQuestion,
  runReviewVerdictShadow,
  sectionVerdictBaseline,
  type ReviewDecisionRow,
  type ReviewSectionFacts,
} from "./decision.js";
import type { DecisionProvider, DecisionRequest } from "@video/llm";
import type { ReviewPackage } from "./schemas.js";

const section: ReviewSectionFacts = {
  section: "content",
  fields: [
    {
      name: "accuracy",
      status: "warn",
      evidence: "no claims artifact supplied",
    },
    { name: "logic", status: "ok" },
  ],
  findings: [
    {
      id: "F001",
      severity: "minor",
      reference: "scene-05 narration",
      observation:
        "The attribution cannot be verified from the supplied evidence.",
    },
  ],
};

function fakeProvider(answer: string | null = "warn"): DecisionProvider {
  return {
    name: "fake",
    lastError: null,
    available: () => true,
    decide: async (_req: DecisionRequest) => {
      if (answer === null) return null;
      return {
        value: { kind: "choice", option: answer },
        confidence: 0.8,
        confidenceSource: "native",
        usage: { input: 300, output: 0 },
        latencyMs: 9,
        provider: "fake",
        model: "fake-1",
      };
    },
  };
}

describe("buildReviewVerdictState", () => {
  it("carries the fields and the findings", () => {
    const state = buildReviewVerdictState(section);
    expect(state).toContain("accuracy: warn");
    expect(state).toContain("no claims artifact supplied");
    expect(state).toContain("F001: [minor]");
  });

  it("never carries the section's own verdict", () => {
    // The state must not contain the answer — the model has to earn it.
    const state = buildReviewVerdictState(section);
    expect(state).not.toContain("overall");
    expect(state).not.toMatch(/\b(pass|warn|fail)\b\s*$/m);
  });

  it("says so when a section has no findings", () => {
    const state = buildReviewVerdictState({ ...section, findings: [] });
    expect(state).toContain("No findings.");
  });
});

describe("reviewVerdictQuestion", () => {
  it("offers the three verdicts", () => {
    expect(reviewVerdictQuestion("content").options).toEqual([
      "pass",
      "warn",
      "fail",
    ]);
  });
});

describe("sectionVerdictBaseline", () => {
  it("fails a section with a failed field", () => {
    expect(
      sectionVerdictBaseline({
        ...section,
        fields: [{ name: "accuracy", status: "fail" }],
      }),
    ).toBe("fail");
  });

  it("warns a section with a warned field", () => {
    expect(sectionVerdictBaseline(section)).toBe("warn");
  });

  it("warns a section with a serious finding but no warned field", () => {
    expect(
      sectionVerdictBaseline({
        ...section,
        fields: [{ name: "logic", status: "ok" }],
        findings: [{ observation: "x", severity: "major" }],
      }),
    ).toBe("warn");
  });

  it("passes a clean section", () => {
    expect(
      sectionVerdictBaseline({
        section: "visual",
        fields: [{ name: "readability", status: "ok" }],
        findings: [],
      }),
    ).toBe("pass");
  });
});

describe("reviewSectionFacts", () => {
  const pkg = {
    content: {
      accuracy: { status: "warn", evidence: "no claims artifact" },
      logic: { status: "ok", evidence: null },
      unsupported_claims: [
        {
          id: "F001",
          severity: "minor",
          observation: "unverifiable",
          reference: "scene-05",
        },
      ],
      contradictions: [],
      repetition: [],
      overall: "warn",
    },
  } as unknown as ReviewPackage;

  it("splits the section into fields and findings", () => {
    const facts = reviewSectionFacts(pkg, "content");
    expect(facts.fields.map((f) => f.name)).toEqual(["accuracy", "logic"]);
    expect(facts.findings).toHaveLength(1);
    expect(facts.findings[0]?.observation).toBe("unverifiable");
  });

  it("drops the section's own verdict", () => {
    const facts = reviewSectionFacts(pkg, "content");
    expect(JSON.stringify(facts)).not.toContain("overall");
  });
});

describe("consultReviewVerdict", () => {
  it("records the answer and the agreement with the artifact's verdict", async () => {
    const row = await consultReviewVerdict({
      project: "demo",
      section,
      baseline: "warn",
      provider: fakeProvider("warn"),
      mode: "shadow",
    });
    expect(row.surface).toBe("review-verdict");
    expect(row.answer).toBe("warn");
    expect(row.agreed).toBe(true);
    expect(row.baseline).toBe("warn");
  });

  it("records a disagreement", async () => {
    const row = await consultReviewVerdict({
      project: "demo",
      section,
      baseline: "warn",
      provider: fakeProvider("fail"),
      mode: "shadow",
    });
    expect(row.agreed).toBe(false);
  });

  it("records no answer when the provider fails", async () => {
    const row = await consultReviewVerdict({
      project: "demo",
      section,
      baseline: "warn",
      provider: fakeProvider(null),
      mode: "shadow",
    });
    expect(row.answer).toBeNull();
    expect(row.agreed).toBeNull();
  });

  it("never writes the raw state into the row", async () => {
    const row = await consultReviewVerdict({
      project: "demo",
      section,
      baseline: "warn",
      provider: fakeProvider(),
      mode: "shadow",
    });
    expect(JSON.stringify(row)).not.toContain("claims artifact");
  });
});

describe("runReviewVerdictShadow", () => {
  it("does nothing in off mode", async () => {
    const out = await runReviewVerdictShadow({
      project: "demo",
      sections: [{ section, baseline: "warn" }],
      mode: "off",
      provider: fakeProvider(),
    });
    expect(out.consulted).toBe(0);
  });

  it("appends one row per section", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "review-shadow-"));
    const logPath = path.join(dir, "decision-log.jsonl");
    const out = await runReviewVerdictShadow({
      project: "demo",
      sections: [
        { section, baseline: "warn" },
        { section: { ...section, section: "visual" }, baseline: "pass" },
      ],
      mode: "shadow",
      provider: fakeProvider(),
      logPath,
    });
    expect(out.consulted).toBe(2);
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as ReviewDecisionRow);
    expect(rows[0]?.surface).toBe("review-verdict");
    expect(rows[1]?.section).toBe("visual");
  });

  it("skips cleanly when no provider has a key", async () => {
    const key = process.env["OPENAI_API_KEY"];
    const minimaxKey = process.env["MINIMAX_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["MINIMAX_API_KEY"];
    const seen: string[] = [];
    const original = console.error;
    console.error = (message: string) => seen.push(message);
    try {
      const out = await runReviewVerdictShadow({
        project: "demo",
        sections: [{ section, baseline: "warn" }],
        mode: "shadow",
      });
      expect(out.consulted).toBe(0);
      expect(seen.some((m) => m.includes("key not set"))).toBe(true);
    } finally {
      console.error = original;
      if (key !== undefined) process.env["OPENAI_API_KEY"] = key;
      if (minimaxKey !== undefined) {
        process.env["MINIMAX_API_KEY"] = minimaxKey;
      }
    }
  });

  it("honours DECISION_PROVIDER and DECISION_MODEL from the environment", async () => {
    const key = process.env["OPENAI_API_KEY"];
    const minimaxKey = process.env["MINIMAX_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["MINIMAX_API_KEY"];
    const original = console.error;
    console.error = () => {};
    try {
      const out = await runReviewVerdictShadow({
        project: "demo",
        sections: [{ section, baseline: "warn" }],
        mode: "shadow",
        env: {
          DECISION_PROVIDER: "minimax",
          DECISION_MODEL: "MiniMax-M3.1-Flash",
        } as NodeJS.ProcessEnv,
      });
      expect(out.consulted).toBe(0);
    } finally {
      console.error = original;
      if (key !== undefined) process.env["OPENAI_API_KEY"] = key;
      if (minimaxKey !== undefined) {
        process.env["MINIMAX_API_KEY"] = minimaxKey;
      }
    }
  });
});
