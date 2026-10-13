import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, buildMessages } from "./prompt.js";

const BASE = {
  topic: "思维链",
  audience: "developers",
  language: "zh-CN" as const,
  duration: 40,
};

describe("research prompt", () => {
  it("emits the four core inputs", () => {
    const user = buildMessages(BASE)[1]?.content ?? "";
    expect(user).toContain("Topic: 思维链");
    expect(user).toContain("Audience: developers");
    expect(user).toContain("Language: zh-CN");
    expect(user).toContain("Total duration target (seconds): 40");
  });

  it("numbers web results and truncates snippets to 200 chars", () => {
    const user =
      buildMessages({
        ...BASE,
        webContext: [
          { title: "A", url: "https://a", snippet: "x".repeat(400) },
          { title: "B", url: "https://b", snippet: "y" },
        ],
      })[1]?.content ?? "";
    expect(user).toContain("[w1] A — https://a");
    expect(user).toContain("[w2] B — https://b");
    expect(user).toContain("x".repeat(200));
    expect(user).not.toContain("x".repeat(201));
  });

  it("omits the web block when no results are given", () => {
    const user = buildMessages(BASE)[1]?.content ?? "";
    expect(user).not.toContain("web search results");
  });

  it("system prompt declares the Research Agent role", () => {
    expect(SYSTEM_PROMPT).toContain("Research Agent");
  });
});
