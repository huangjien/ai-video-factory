import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, buildMessages, type DraftInput } from "./prompt.js";

const base: DraftInput = {
  topic: "思维链",
  audience: "developers",
  language: "zh-CN",
  duration: 40,
};

describe("SYSTEM_PROMPT contract", () => {
  it("demands JSON-only output", () => {
    expect(SYSTEM_PROMPT).toContain("valid JSON");
    expect(SYSTEM_PROMPT).toContain("nothing except the JSON object");
  });

  it("documents both output languages", () => {
    expect(SYSTEM_PROMPT).toContain("zh-CN");
    expect(SYSTEM_PROMPT).toContain("en-US");
  });

  it("fixes the scene shape the schemas expect", () => {
    expect(SYSTEM_PROMPT).toContain('"scenes"');
    expect(SYSTEM_PROMPT).toContain('"narration"');
    expect(SYSTEM_PROMPT).toContain('"visual"');
  });
});

describe("buildMessages", () => {
  it("always emits system + user with the four core inputs", () => {
    const msgs = buildMessages(base);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("system");
    expect(msgs[0]?.content).toBe(SYSTEM_PROMPT);
    const user = msgs[1]?.content ?? "";
    expect(user).toContain("Topic: 思维链");
    expect(user).toContain("Audience: developers");
    expect(user).toContain("Language: zh-CN");
    expect(user).toContain("Total duration target (seconds): 40");
  });

  it("includes judge feedback as a revision instruction", () => {
    const user = buildMessages({ ...base, feedback: "hook too weak; add numbers" })[1]?.content ?? "";
    expect(user).toContain("Revision feedback");
    expect(user).toContain("previous draft was rejected");
    expect(user).toContain("hook too weak; add numbers");
  });

  it("omits every optional block when not provided", () => {
    const user = buildMessages(base)[1]?.content ?? "";
    expect(user).not.toContain("Existing content to revise");
    expect(user).not.toContain("--file");
    expect(user).not.toContain("web search results");
    expect(user).not.toContain("Revision feedback");
  });

  it("truncates web snippets to 200 chars", () => {
    const user =
      buildMessages({
        ...base,
        webContext: [
          {
            url: "https://example.com/a",
            title: "A",
            snippet: "x".repeat(500),
          },
        ],
      })[1]?.content ?? "";
    expect(user).toContain("[w1] A — https://example.com/a");
    expect(user).toContain("x".repeat(200));
    expect(user).not.toContain("x".repeat(201));
  });

  it("stacks every optional block in one message", () => {
    const user =
      buildMessages({
        ...base,
        fromContent: "OLD ARTICLE",
        ideaSeed: "MY OPINION",
        webContext: [{ url: "u", title: "t", snippet: "s" }],
        feedback: "FIX ME",
      })[1]?.content ?? "";
    expect(user).toContain("OLD ARTICLE");
    expect(user).toContain("MY OPINION");
    expect(user).toContain("do NOT change");
    expect(user).toContain("[w1] t — u");
    expect(user).toContain("FIX ME");
  });
});

describe("buildMessages — edges", () => {
  it("passes en-US through as the language directive", () => {
    const user = buildMessages({ ...base, language: "en-US" })[1]?.content ?? "";
    expect(user).toContain("Language: en-US");
  });

  it("starts the user message with the topic line", () => {
    const user = buildMessages(base)[1]?.content ?? "";
    expect(user.startsWith("Topic: 思维链")).toBe(true);
  });

  it("places revision feedback last, after web context", () => {
    const user =
      buildMessages({
        ...base,
        webContext: [{ url: "u", title: "t", snippet: "s" }],
        feedback: "fix hook",
      })[1]?.content ?? "";
    expect(user.indexOf("web search results")).toBeLessThan(
      user.indexOf("Revision feedback"),
    );
  });
});

describe("SYSTEM_PROMPT — length guidance", () => {
  it("documents spoken narration rates for both languages", () => {
    expect(SYSTEM_PROMPT).toContain("130-155");
    expect(SYSTEM_PROMPT).toContain("220-300");
  });
});

describe("buildMessages — ordering + numbering", () => {
  it("numbers multiple web results [w1] [w2]", () => {
    const user =
      buildMessages({
        ...base,
        webContext: [
          { url: "u1", title: "t1", snippet: "s1" },
          { url: "u2", title: "t2", snippet: "s2" },
        ],
      })[1]?.content ?? "";
    expect(user).toContain("[w1] t1 — u1");
    expect(user).toContain("[w2] t2 — u2");
  });

  it("places revision content before the user's idea seed", () => {
    const user =
      buildMessages({ ...base, fromContent: "REVISION", ideaSeed: "IDEA" })[1]
        ?.content ?? "";
    expect(user.indexOf("REVISION")).toBeLessThan(user.indexOf("IDEA"));
  });
});
