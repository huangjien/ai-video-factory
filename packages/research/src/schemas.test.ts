import { describe, expect, it } from "vitest";
import {
  ClaimSchema,
  ResearchOutputSchema,
  SourceSchema,
  buildMessages,
} from "./index.js";

describe("SourceSchema (todo 1) — §55 sources.yaml", () => {
  it("accepts a valid source", () => {
    const r = SourceSchema.safeParse({
      id: "s1",
      url: "https://example.com",
      title: "Example",
      accessed: "2026-09-20",
      snippet: "Some snippet",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown keys (strict)", () => {
    const r = SourceSchema.safeParse({
      id: "s1",
      url: "https://example.com",
      title: "Example",
      accessed: "2026-09-20",
      snippet: "x",
      bogus: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty id", () => {
    const r = SourceSchema.safeParse({
      id: "",
      url: "https://example.com",
      title: "Example",
      accessed: "2026-09-20",
      snippet: "x",
    });
    expect(r.success).toBe(false);
  });
});

describe("ClaimSchema (todo 1) — §55 claims.yaml", () => {
  it("accepts a fact claim with sources", () => {
    const r = ClaimSchema.safeParse({
      id: "c1",
      claim: "The sky is blue",
      status: "fact",
      sources: ["s1"],
    });
    expect(r.success).toBe(true);
  });

  it("accepts an opinion claim (sources optional)", () => {
    const r = ClaimSchema.safeParse({
      id: "c2",
      claim: "Blue is calming",
      status: "opinion",
      sources: [],
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown status enum", () => {
    const r = ClaimSchema.safeParse({
      id: "c3",
      claim: "x",
      status: "guessing",
      sources: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const r = ClaimSchema.safeParse({
      id: "c4",
      claim: "x",
      status: "fact",
      sources: [],
      extra: "no",
    });
    expect(r.success).toBe(false);
  });
});

describe("ResearchOutputSchema (todo 1)", () => {
  it("accepts a fully-valid output", () => {
    const r = ResearchOutputSchema.safeParse({
      markdown: "# research\n...",
      sources: [
        {
          id: "s1",
          url: "https://example.com",
          title: "Example",
          accessed: "2026-09-20",
          snippet: "x",
        },
      ],
      claims: [{ id: "c1", claim: "x", status: "fact", sources: ["s1"] }],
      meta: {
        web_search_used: false,
        web_search_failed: false,
        provider: "minimax",
        model: "MiniMax-M3",
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects output missing meta", () => {
    const r = ResearchOutputSchema.safeParse({
      markdown: "x",
      sources: [],
      claims: [],
    });
    expect(r.success).toBe(false);
  });
});

describe("buildMessages (todo 1) — prompt structure", () => {
  it("emits system + user messages with topic and audience", () => {
    const m = buildMessages({
      topic: "AI 思维链",
      audience: "developers",
      language: "zh-CN",
      duration: 40,
    });
    expect(m[0]?.role).toBe("system");
    expect(m[1]?.role).toBe("user");
    expect(m[1]?.content).toContain("AI 思维链");
    expect(m[1]?.content).toContain("developers");
    expect(m[1]?.content).toContain("zh-CN");
  });

  it("includes web context when provided", () => {
    const m = buildMessages({
      topic: "t",
      audience: "a",
      language: "zh-CN",
      duration: 40,
      webContext: [
        {
          url: "https://example.com",
          title: "Ex",
          snippet: "An important snippet about X.",
        },
      ],
    });
    expect(m[1]?.content).toContain("An important snippet about X");
    expect(m[1]?.content).toContain("https://example.com");
  });
});
