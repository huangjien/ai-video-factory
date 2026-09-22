import { describe, expect, it } from "vitest";
import { SourceSchema, normalizeUrl } from "./schemas.js";

describe("normalizeUrl (LLM-URL repair)", () => {
  it("passes valid URLs through unchanged", () => {
    expect(normalizeUrl("https://example.com/page")).toBe(
      "https://example.com/page",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeUrl("  https://example.com/a  ")).toBe(
      "https://example.com/a",
    );
  });

  it("prepends https:// to bare domains", () => {
    expect(normalizeUrl("www.zhihu.com/question/123456")).toBe(
      "https://www.zhihu.com/question/123456",
    );
    expect(normalizeUrl("docs.python.org/3/library")).toBeDefined();
  });

  it("encodes internal spaces as %20", () => {
    expect(normalizeUrl("https://example.com/a b")).toBe(
      "https://example.com/a%20b",
    );
  });

  it("strips trailing citation-style junk after a URL", () => {
    expect(normalizeUrl("https://example.com/page （访问于 2024）")).toBe(
      "https://example.com/page",
    );
  });

  it("returns the original for unparseable input (schema rejects later)", () => {
    expect(normalizeUrl("not a url at all !!!")).toBe("not a url at all !!!");
  });
});

describe("SourceSchema with URL normalization", () => {
  const base = {
    id: "s1",
    title: "Example",
    accessed: "2026-09-22",
    snippet: "text",
  };

  it("accepts a bare-domain URL from an LLM (auto-prefixes https://)", () => {
    const r = SourceSchema.safeParse({ ...base, url: "www.example.com/x" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.url).toBe("https://www.example.com/x");
  });

  it("accepts a URL with surrounding whitespace", () => {
    const r = SourceSchema.safeParse({ ...base, url: " https://example.com " });
    expect(r.success).toBe(true);
  });

  it("still rejects garbage that is not remotely a URL", () => {
    const r = SourceSchema.safeParse({ ...base, url: "???" });
    expect(r.success).toBe(false);
  });
});
