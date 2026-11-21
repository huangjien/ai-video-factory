import { describe, expect, it } from "vitest";
import {
  clampProbability,
  stateToText,
  validateDecisionBatch,
  validateQuestion,
  type DecisionQuestion,
} from "./contract.js";

function question(over: Partial<DecisionQuestion> = {}): DecisionQuestion {
  return {
    id: "q1",
    kind: "choice",
    instructions: "Which component fits the scene?",
    options: ["Title", "FlowChart"],
    ...over,
  };
}

describe("decision contract", () => {
  it("clamps a probability above one", () => {
    expect(clampProbability(1.4)).toBe(1);
  });

  it("turns a non-finite probability into zero", () => {
    expect(clampProbability(Number.NaN)).toBe(0);
  });

  it("passes a structured state through as JSON", () => {
    expect(stateToText({ frame: 12 })).toContain('"frame": 12');
  });

  it("passes a string state through unchanged", () => {
    expect(stateToText("frame 12")).toBe("frame 12");
  });

  it("accepts a choice question with two options", () => {
    expect(() => validateQuestion(question())).not.toThrow();
  });

  it("rejects a choice question with one option", () => {
    expect(() => validateQuestion(question({ options: ["Title"] }))).toThrow(
      /at least 2 options/,
    );
  });

  it("rejects a score question without levels", () => {
    expect(() =>
      validateQuestion(
        question({ kind: "score", options: undefined, levels: [] }),
      ),
    ).toThrow(/at least 2 levels/);
  });

  it("rejects a question without instructions", () => {
    expect(() => validateQuestion(question({ instructions: "  " }))).toThrow(
      /needs instructions/,
    );
  });

  it("accepts a shared input with uniquely named questions", () => {
    expect(() =>
      validateDecisionBatch({
        input: [{ type: "text", text: "shared context" }],
        questions: [
          { question: question({ id: "a" }) },
          { question: question({ id: "b", kind: "noul", options: undefined }) },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects duplicate question IDs and invalid confidence thresholds", () => {
    expect(() =>
      validateDecisionBatch({
        input: [{ type: "text", text: "context" }],
        questions: [{ question: question() }, { question: question() }],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      validateDecisionBatch({
        input: [{ type: "text", text: "context" }],
        questions: [{ question: question(), minConfidence: -0.1 }],
      }),
    ).toThrow(/minimum confidence/);
  });

  it("rejects an empty input and batches larger than the Google limit", () => {
    expect(() =>
      validateDecisionBatch({
        input: [],
        questions: [{ question: question() }],
      }),
    ).toThrow(/input is empty/);
    expect(() =>
      validateDecisionBatch({
        input: [{ type: "text", text: "context" }],
        questions: Array.from({ length: 1001 }, (_, id) => ({
          question: question({ id: `q${id}` }),
        })),
      }),
    ).toThrow(/1 to 1000/);
  });
});
