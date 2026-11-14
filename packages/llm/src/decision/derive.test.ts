import { describe, expect, it } from "vitest";
import {
  deriveValueFromDistribution,
  winnerKey,
} from "./derive.js";
import type { DecisionQuestion } from "./contract.js";

const choiceQuestion: DecisionQuestion = {
  id: "q1",
  kind: "choice",
  instructions: "Which component fits the scene?",
  options: ["Title", "FlowChart", "Timeline"],
};

const scoreQuestion: DecisionQuestion = {
  id: "q2",
  kind: "score",
  instructions: "How urgent is the finding?",
  levels: ["cosmetic", "blocking"],
};

describe("winnerKey", () => {
  it("returns the key with the highest probability", () => {
    expect(winnerKey({ a: 0.2, b: 0.8 })).toBe("b");
  });
});

describe("deriveValueFromDistribution", () => {
  it("maps the winning option onto the option name", () => {
    const value = deriveValueFromDistribution(choiceQuestion, {
      Title: 0.1,
      FlowChart: 0.7,
      Timeline: 0.2,
    });
    expect(value?.kind === "choice" ? value.option : null).toBe("FlowChart");
  });

  it("keys the choice distribution by option name", () => {
    const value = deriveValueFromDistribution(choiceQuestion, {
      Title: 0.1,
      FlowChart: 0.7,
      Timeline: 0.2,
    });
    expect(
      value?.kind === "choice" ? value.probabilities?.["Timeline"] : null,
    ).toBe(0.2);
  });

  it("averages the score over the level positions", () => {
    const value = deriveValueFromDistribution(scoreQuestion, {
      cosmetic: 0.25,
      blocking: 0.75,
    });
    // level 0 = "cosmetic", level 1 = "blocking" → 0.25·0 + 0.75·1
    expect(value?.kind === "score" ? value.score : null).toBeCloseTo(0.75, 5);
  });

  it("builds the score legend from the level order", () => {
    const value = deriveValueFromDistribution(scoreQuestion, {
      cosmetic: 0.25,
      blocking: 0.75,
    });
    expect(value?.kind === "score" ? value.legend["1"] : null).toBe("blocking");
  });

  it("reads the noul probability from the true key", () => {
    const noul: DecisionQuestion = {
      id: "q3",
      kind: "noul",
      instructions: "Does the caption overlap the subtitle band?",
    };
    const value = deriveValueFromDistribution(noul, {
      true: 0.8,
      false: 0.2,
    });
    expect(value?.kind === "noul" ? value.probability : null).toBeCloseTo(0.8, 5);
  });

  it("returns null when the distribution is empty", () => {
    expect(deriveValueFromDistribution(scoreQuestion, {})).toBeNull();
  });

  it("returns null when no noul side has mass", () => {
    const noul: DecisionQuestion = {
      id: "q3",
      kind: "noul",
      instructions: "Does the caption overlap the subtitle band?",
    };
    expect(deriveValueFromDistribution(noul, {})).toBeNull();
  });
});
