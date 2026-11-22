import { describe, expect, it } from "vitest";
import {
  resolveGeneratorName,
  resolveJudgePick,
  resolvePoolPick,
} from "./draft-command.js";
import type { ProviderConfig } from "@video/llm";

const cfg: ProviderConfig = {
  research: { primary: "minimax", fallback: "glm" },
  review: { primary: "minimax", fallback: "glm" },
} as unknown as ProviderConfig;

describe("resolvePoolPick — the generator pool", () => {
  const pool = ["openai", "gemini", "glm"] as const;

  it("draws from the pool when --model is absent", () => {
    expect(resolvePoolPick(undefined, [...pool], () => 0)).toBe("openai");
  });

  it("draws from the pool for an explicit --model auto", () => {
    expect(resolvePoolPick("auto", [...pool], () => 0.5)).toBe("gemini");
  });

  it("honours a named provider verbatim", () => {
    expect(resolvePoolPick("glm", [...pool], () => 0)).toBeNull();
    expect(resolvePoolPick("minimax", [...pool], () => 0)).toBeNull();
  });

  it("is null when the pool is empty (no keys set)", () => {
    expect(resolvePoolPick(undefined, [], () => 0)).toBeNull();
  });
});

describe("resolveGeneratorName — which provider writes the article", () => {
  it("uses the pool pick when there is one", () => {
    expect(resolveGeneratorName(undefined, "gemini", cfg)).toBe("gemini");
  });

  it("uses the named provider when the caller named it", () => {
    expect(resolveGeneratorName("glm", null, cfg)).toBe("glm");
  });

  it("falls back to the research role when nothing was named", () => {
    expect(resolveGeneratorName(undefined, null, cfg)).toBe("minimax");
  });
});

describe("resolveJudgePick — MiniMax judges, generators rotate", () => {
  it("judges with minimax when its key is set", () => {
    const pick = resolveJudgePick({
      generator: "openai",
      cfg,
      minimaxCanJudge: true,
    });
    expect(pick.name).toBe("minimax");
  });

  it("an explicit --judge-model wins", () => {
    const pick = resolveJudgePick({
      judgeModel: "glm",
      generator: "openai",
      cfg,
      minimaxCanJudge: true,
    });
    expect(pick.name).toBe("glm");
  });

  it("falls back to the review role when minimax has no key", () => {
    const pick = resolveJudgePick({
      generator: "openai",
      cfg,
      minimaxCanJudge: false,
    });
    expect(pick.name).toBe("minimax");
    expect(pick.flipped).toBe(false);
  });

  it("never lets the judge be the generator", () => {
    const pick = resolveJudgePick({
      generator: "minimax",
      cfg,
      minimaxCanJudge: true,
    });
    expect(pick.name).not.toBe("minimax");
  });
});
