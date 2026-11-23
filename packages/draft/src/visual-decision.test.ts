import { describe, expect, it } from "vitest";
import {
  createDecisionProvider,
  isQuotaError,
  resolveDecisionMode,
} from "@video/llm";
// The runtime helpers are re-exported here so @video/draft consumers keep
// one import surface; the implementations live in @video/llm.
import { decisionLogPath } from "./visual-decision.js";

describe("resolveDecisionMode (re-export)", () => {
  it("defaults to on", () => {
    expect(resolveDecisionMode({})).toBe("on");
  });

  it("reads shadow and off", () => {
    expect(resolveDecisionMode({ DECISION_MODE: "shadow" })).toBe("shadow");
    expect(resolveDecisionMode({ DECISION_MODE: "off" })).toBe("off");
  });

  it("rejects an unknown mode", () => {
    expect(() => resolveDecisionMode({ DECISION_MODE: "loud" })).toThrow(
      /unknown DECISION_MODE/,
    );
  });
});

describe("createDecisionProvider (re-export)", () => {
  it("builds the fallback chain by default (google → openai → minimax)", () => {
    expect(createDecisionProvider().name).toBe("google→openai→minimax");
  });

  it("pins a single provider on request", () => {
    expect(createDecisionProvider({ provider: "openai" }).name).toBe("openai");
    expect(createDecisionProvider({ provider: "minimax" }).name).toBe("minimax");
  });

  it("builds the minimax provider on request", () => {
    expect(createDecisionProvider({ provider: "minimax" }).name).toBe(
      "minimax",
    );
  });

  it("rejects an unknown provider", () => {
    expect(() => createDecisionProvider({ provider: "nope" })).toThrow(
      /unknown decision provider/,
    );
  });
});

describe("quota visibility (re-export)", () => {
  it("recognises MiniMax's monthly-quota error", () => {
    expect(
      isQuotaError(
        'MiniMax API 429: {"error":{"type":"rate_limit_error","message":"Token Plan usage limit reached (2056)"}}',
      ),
    ).toBe(true);
  });

  it("does not mistake a timeout for a quota", () => {
    expect(isQuotaError("AbortError: The operation was aborted")).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

describe("decisionLogPath (re-export)", () => {
  it("appends the log filename to a project root", () => {
    expect(decisionLogPath("/tmp/demo")).toBe("/tmp/demo/decision-log.jsonl");
  });
});
