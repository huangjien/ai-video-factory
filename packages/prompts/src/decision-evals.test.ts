import { describe, expect, it } from "vitest";
import {
  DECISION_POLICY_RULES,
  decisionsDir,
  listDecisionCaseIds,
  listDecisionCases,
  listDecisionSurfacesWithCases,
  loadDecisionCase,
  loadDecisionPrices,
  parseDecisionCase,
  verdictToLabel,
} from "./decision-evals.js";
import { DECISION_QUESTIONS, listDecisionSurfaces } from "./decision-questions.js";
import { listPromptFiles, loadedPromptNames } from "./index.js";

describe("decision questions", () => {
  it("every surface has a prompt body on disk", () => {
    for (const surface of listDecisionSurfaces()) {
      const spec = DECISION_QUESTIONS[surface];
      expect(listPromptFiles()).toContain(`${spec.prompt}.md`);
    }
  });

  it("every decision prompt body is loaded", () => {
    const loaded = loadedPromptNames();
    for (const surface of listDecisionSurfaces()) {
      expect(loaded).toContain(DECISION_QUESTIONS[surface].prompt);
    }
  });
});

describe("decision corpus", () => {
  it("has cases for at least three surfaces", () => {
    expect(listDecisionSurfacesWithCases().length).toBeGreaterThanOrEqual(3);
  });

  it("every case file is reachable through the loader", () => {
    const listed = listDecisionCases().map((ref) => ref.file);
    for (const surface of listDecisionSurfacesWithCases()) {
      for (const id of listDecisionCaseIds(decisionsDir(), surface)) {
        expect(listed.some((f) => f.endsWith(`${surface}/${id}.yaml`))).toBe(true);
      }
    }
  });

  it("every case names the failure it encodes", () => {
    for (const ref of listDecisionCases()) {
      expect(ref.fixture.provenance.source.length).toBeGreaterThan(10);
    }
  });

  it("every case carries a label", () => {
    for (const ref of listDecisionCases()) {
      expect(ref.fixture.expects.value).toBeDefined();
    }
  });

  it("a case in an unknown surface is rejected", () => {
    expect(() =>
      parseDecisionCase("bad.yaml", {
        id: "x",
        surface: "not-a-surface",
        state: "s",
        expects: { kind: "choice", value: "pass" },
        provenance: { source: "s" },
      }),
    ).toThrow(/unknown surface/);
  });

  it("a choice label outside the surface's options is rejected", () => {
    expect(() =>
      parseDecisionCase("bad.yaml", {
        id: "x",
        surface: "qa-triage",
        state: "s",
        expects: { kind: "choice", value: "nope" },
        provenance: { source: "s" },
      }),
    ).toThrow(/not one of the surface's options/);
  });

  it("a label whose kind contradicts the question is rejected", () => {
    expect(() =>
      parseDecisionCase("bad.yaml", {
        id: "x",
        surface: "qa-triage",
        state: "s",
        expects: { kind: "noul", value: "true" },
        provenance: { source: "s" },
      }),
    ).toThrow(/does not match the surface's question kind/);
  });

  it("a case without provenance is rejected", () => {
    expect(() =>
      parseDecisionCase("bad.yaml", {
        id: "x",
        surface: "qa-triage",
        state: "s",
        expects: { kind: "choice", value: "pass" },
      }),
    ).toThrow(/provenance.source/);
  });

  it("every case records the labelling rule that produced its label", () => {
    for (const ref of listDecisionCases()) {
      expect(ref.fixture.policy?.rule).toBeDefined();
    }
  });

  it("every case's rule belongs to its surface", () => {
    for (const ref of listDecisionCases()) {
      const allowed = DECISION_POLICY_RULES[ref.surface];
      expect(allowed).toContain(ref.fixture.policy?.rule);
    }
  });

  it("rejects a rule from another surface", () => {
    expect(() =>
      parseDecisionCase("bad.yaml", {
        id: "x",
        surface: "qa-triage",
        state: "s",
        expects: { kind: "choice", value: "pass" },
        policy: { rule: "review-verdict" },
        provenance: { source: "s" },
      }),
    ).toThrow(/not a rule of the "qa-triage" surface/);
  });

  it("derives the draft-bar label from the artifact's verdict", () => {
    expect(verdictToLabel({ passing: true })).toBe("pass");
    expect(verdictToLabel({ passing: false })).toBe("revise");
    expect(verdictToLabel({ passing: false, critical: true })).toBe("reject");
    // The loop ships drafts that carry MAJOR_REVISION_NEEDED — the flag
    // is advisory, so it must not turn a passing draft into a revise.
    expect(
      verdictToLabel({ passing: true, major_revision_needed: true }),
    ).toBe("pass");
  });

  it("rejects a draft-bar label that disagrees with its own verdict", () => {
    expect(() =>
      parseDecisionCase("bad.yaml", {
        id: "x",
        surface: "draft-bar",
        state: "s",
        expects: { kind: "choice", value: "pass" },
        source_verdict: { passing: false },
        provenance: { source: "s" },
      }),
    ).toThrow(/does not match the verdict rule/);
  });

  it("every draft-bar case's label matches its recorded verdict", () => {
    for (const ref of listDecisionCases({ surface: "draft-bar" })) {
      const verdict = ref.fixture.source_verdict;
      expect(verdict).toBeDefined();
      expect(ref.fixture.expects.value).toBe(verdictToLabel(verdict!));
    }
  });

  it("a disputed case must say why", () => {
    expect(() =>
      parseDecisionCase("bad.yaml", {
        id: "x",
        surface: "qa-triage",
        state: "s",
        expects: { kind: "choice", value: "pass" },
        disputed: true,
        provenance: { source: "s" },
      }),
    ).toThrow(/must say why/);
  });

  it("loads a real case off disk", () => {
    const ref = listDecisionCases({ surface: "qa-triage" })[0];
    expect(ref).toBeDefined();
    const fixture = loadDecisionCase(ref!.file);
    expect(fixture.id).toBe(ref!.id);
  });
});

describe("decision prices", () => {
  it("reads the price table", () => {
    const table = loadDecisionPrices();
    expect(table.prices["openai"]).toBeDefined();
  });

  it("leaves an unknown price null rather than zero", () => {
    const table = loadDecisionPrices();
    const price = table.prices["openai"]?.["gpt-6-luna"];
    expect(price?.input_per_1k ?? null).toBeNull();
  });
});
