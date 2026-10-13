import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, buildMessages } from "./prompt.js";

const BASE = {
  topic: "思维链",
  audience: "developers",
  duration: 40,
  language: "zh-CN" as const,
  style: "paper-light",
};

describe("storyboard prompt", () => {
  it("emits the five core inputs in the user message", () => {
    const user = buildMessages(BASE)[1]?.content ?? "";
    expect(user).toContain("Topic: 思维链");
    expect(user).toContain("Audience: developers");
    expect(user).toContain("Language: zh-CN");
    expect(user).toContain("Total duration target (seconds): 40");
    expect(user).toContain("Style: paper-light");
  });

  it("includes research + claims context with section headers", () => {
    const user =
      buildMessages({
        ...BASE,
        researchContext: { markdown: "RESEARCH MD", claimSummary: "CLAIMS" },
      })[1]?.content ?? "";
    expect(user).toContain("## Supporting research");
    expect(user).toContain("RESEARCH MD");
    expect(user).toContain("### Key claims to incorporate or counter");
    expect(user).toContain("CLAIMS");
  });

  it("truncates research markdown at 2000 chars and claims at 1500", () => {
    const user =
      buildMessages({
        ...BASE,
        researchContext: {
          markdown: "r".repeat(2500),
          claimSummary: "c".repeat(2000),
        },
      })[1]?.content ?? "";
    expect(user).toContain("r".repeat(2000));
    expect(user).not.toContain("r".repeat(2001));
    expect(user).toContain("c".repeat(1500));
    expect(user).not.toContain("c".repeat(1501));
  });

  it("includes script context (≤3000 chars) after research", () => {
    const user =
      buildMessages({
        ...BASE,
        researchContext: { markdown: "R", claimSummary: "C" },
        scriptContext: { markdown: "s".repeat(3200) },
      })[1]?.content ?? "";
    expect(user.indexOf("## Supporting research")).toBeLessThan(
      user.indexOf("## Approved script"),
    );
    expect(user).toContain("s".repeat(3000));
    expect(user).not.toContain("s".repeat(3001));
  });

  it("omits both context blocks when absent", () => {
    const user = buildMessages(BASE)[1]?.content ?? "";
    expect(user).not.toContain("## Supporting research");
    expect(user).not.toContain("## Approved script");
  });

  it("system prompt carries the VDSL few-shot schema sample", () => {
    expect(SYSTEM_PROMPT).toContain("schema_version");
    expect(SYSTEM_PROMPT).toContain("Storyboard Agent");
  });
});
