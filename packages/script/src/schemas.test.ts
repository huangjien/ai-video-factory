import { describe, expect, it } from "vitest";
import { ScriptSchema, buildScriptMessages } from "./index.js";

describe("ScriptSchema (todo 1) — §28 7-section spine", () => {
  it("accepts a valid script with all 7 sections", () => {
    const r = ScriptSchema.safeParse({
      hook: "Hook",
      problem: "Problem",
      explanation: "Explanation",
      example: "Example",
      comparison: "Comparison",
      implication: "Implication",
      conclusion: "Conclusion",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown sections (strict)", () => {
    const r = ScriptSchema.safeParse({
      hook: "h",
      problem: "p",
      explanation: "e",
      example: "x",
      comparison: "c",
      implication: "i",
      conclusion: "k",
      extra: "no",
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing sections", () => {
    const r = ScriptSchema.safeParse({
      hook: "h",
      problem: "p",
    });
    expect(r.success).toBe(false);
  });
});

describe("buildScriptMessages (todo 1)", () => {
  it("includes topic, audience, language, duration", () => {
    const m = buildScriptMessages({
      topic: "AI 思维链",
      audience: "developers",
      language: "zh-CN",
      duration: 40,
    });
    expect(m[0]?.role).toBe("system");
    expect(m[1]?.role).toBe("user");
    expect(m[1]?.content).toContain("AI 思维链");
    expect(m[1]?.content).toContain("developers");
  });

  it("includes research context when provided", () => {
    const m = buildScriptMessages({
      topic: "t",
      audience: "a",
      language: "zh-CN",
      duration: 40,
      researchContext: { markdown: "MARKER-RESEARCH-XYZ" },
    });
    expect(m[1]?.content).toContain("MARKER-RESEARCH-XYZ");
  });

  it("includes story direction when provided", () => {
    const m = buildScriptMessages({
      topic: "t",
      audience: "a",
      language: "zh-CN",
      duration: 40,
      direction: "MARKER-DIRECTION-XYZ",
    });
    expect(m[1]?.content).toContain("MARKER-DIRECTION-XYZ");
  });
});
