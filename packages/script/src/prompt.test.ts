import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, buildScriptMessages } from "./prompt.js";

const BASE = {
  topic: "思维链",
  audience: "developers",
  language: "zh-CN" as const,
  duration: 40,
};

describe("script prompt", () => {
  it("emits the four core inputs", () => {
    const user = buildScriptMessages(BASE)[1]?.content ?? "";
    expect(user).toContain("Topic: 思维链");
    expect(user).toContain("Audience: developers");
    expect(user).toContain("Language: zh-CN");
    expect(user).toContain("Total duration target (seconds): 40");
  });

  it("includes the human story direction when provided", () => {
    const user =
      buildScriptMessages({ ...BASE, direction: "start with the failure story" })[1]
        ?.content ?? "";
    expect(user).toContain("## Story direction");
    expect(user).toContain("start with the failure story");
  });

  it("truncates research context at 2500 chars", () => {
    const user =
      buildScriptMessages({
        ...BASE,
        researchContext: { markdown: "r".repeat(3000) },
      })[1]?.content ?? "";
    expect(user).toContain("r".repeat(2500));
    expect(user).not.toContain("r".repeat(2501));
  });

  it("places the direction before the research context", () => {
    const user =
      buildScriptMessages({
        ...BASE,
        direction: "DIRECTION",
        researchContext: { markdown: "RESEARCH" },
      })[1]?.content ?? "";
    expect(user.indexOf("## Story direction")).toBeLessThan(
      user.indexOf("## Supporting research"),
    );
  });

  it("omits both optional blocks when absent", () => {
    const user = buildScriptMessages(BASE)[1]?.content ?? "";
    expect(user).not.toContain("## Story direction");
    expect(user).not.toContain("## Supporting research");
  });

  it("system prompt requires the 7-section narrative spine", () => {
    expect(SYSTEM_PROMPT).toContain("Script Agent");
  });
});
