import { describe, expect, it } from "vitest";
import {
  availableGenerators,
  GENERATOR_POOL,
  pickGenerator,
} from "./generator-pool.js";

describe("availableGenerators — only pool members with a key", () => {
  it("lists the generators whose key is set and non-empty", () => {
    expect(
      availableGenerators({
        OPENAI_API_KEY: "k",
        GEMINI_API_KEY: "  ",
        GLM_API_KEY: "k2",
      }),
    ).toEqual(["openai", "glm"]);
  });

  it("is empty when no pool member holds a key", () => {
    expect(availableGenerators({})).toEqual([]);
  });

  it("never includes minimax — that is the judge", () => {
    expect(GENERATOR_POOL).not.toContain("minimax" as never);
    expect(
      availableGenerators({ MINIMAX_API_KEY: "k" }),
    ).toEqual([]);
  });
});

describe("pickGenerator — uniform, testable choice", () => {
  const pool = ["openai", "gemini", "glm"] as const;

  it("maps the rng to a pool member", () => {
    expect(pickGenerator([...pool], () => 0)).toBe("openai");
    expect(pickGenerator([...pool], () => 0.5)).toBe("gemini");
    expect(pickGenerator([...pool], () => 0.99)).toBe("glm");
  });

  it("returns null for an empty pool", () => {
    expect(pickGenerator([])).toBeNull();
  });

  it("clamps an rng of 1.0 to the last member", () => {
    expect(pickGenerator([...pool], () => 1)).toBe("glm");
  });
});
