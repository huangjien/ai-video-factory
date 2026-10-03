import { describe, expect, it } from "vitest";
import { REGISTRY } from "./registry.js";

describe("REGISTRY accepts LLM-drifted component props (loose schemas)", () => {
  function validate(component: string, props: unknown) {
    const entry = REGISTRY[component as keyof typeof REGISTRY];
    if (!entry) throw new Error(`unknown component ${component}`);
    return entry.propsSchema.safeParse(props);
  }

  it("Title accepts extra props the LLM invented (e.g. subtitle)", () => {
    const r = validate("Title", { text: "hi", subtitle: "lo" });
    expect(r.success).toBe(true);
  });

  it("Paragraph accepts extra props the LLM invented (e.g. highlight_keywords)", () => {
    const r = validate("Paragraph", {
      text: "lo",
      highlight_keywords: ["a", "b"],
    });
    expect(r.success).toBe(true);
  });

  it("FlowChart accepts extra props (e.g. layout)", () => {
    const r = validate("FlowChart", {
      nodes: ["a"],
      edges: [],
      layout: "horizontal",
    });
    expect(r.success).toBe(true);
  });

  it("Callout accepts icon/content as alias for kind/text", () => {
    // LLM sends icon+content; we coerce: icon="info", content="text" default
    const r = validate("Callout", {
      icon: "info",
      content: "important message",
    });
    expect(r.success).toBe(true);
  });

  it("Callout accepts the canonical kind/text fields", () => {
    const r = validate("Callout", { kind: "warning", text: "watch out" });
    expect(r.success).toBe(true);
  });

  it("Callout falls back to defaults when LLM omits fields", () => {
    // Just an empty object — kind defaults to "info", text to ""
    const r = validate("Callout", {});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.kind).toBe("info");
      expect(r.data.text).toBe("");
    }
  });

  it("Comparison accepts left_title/right_title/etc. as alias for title", () => {
    const r = validate("Comparison", {
      left_title: "Pros",
      left_items: ["a", "b"],
      right_title: "Cons",
      right_items: ["c", "d"],
    });
    expect(r.success).toBe(true);
  });

  it("Comparison accepts missing left/right (default to empty side)", () => {
    const r = validate("Comparison", {});
    expect(r.success).toBe(true);
  });

  it("EndCard accepts cta_text/cta_url/disclaimer (alias for cta + ignore)", () => {
    const r = validate("EndCard", {
      title: "Done",
      cta_text: "Subscribe",
      cta_url: "https://example.com",
      disclaimer: "Legal text",
    });
    expect(r.success).toBe(true);
  });
});

describe("v0.4.2 component schemas", () => {
  function validate(component: string, props: unknown) {
    const entry = REGISTRY[component as keyof typeof REGISTRY];
    if (!entry) throw new Error(`unknown component ${component}`);
    return entry.propsSchema.safeParse(props);
  }

  it("QuoteBlock aliases text/content → quote and citation → author", () => {
    const r = validate("QuoteBlock", {
      text: "Stay hungry",
      citation: "Jobs",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.quote).toBe("Stay hungry");
      expect(r.data.author).toBe("Jobs");
    }
  });

  it("StatGrid requires stats but tolerates extra props", () => {
    expect(validate("StatGrid", { stats: [{ value: "5x", label: "faster" }] }).success).toBe(true);
    expect(validate("StatGrid", { stats: [{ value: "5x" }], note: "hi" }).success).toBe(true);
    expect(validate("StatGrid", {}).success).toBe(false);
  });

  it("BarChart requires bars; entries default missing fields", () => {
    const r = validate("BarChart", { bars: [{ label: "a" }] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.bars[0].value).toBe(0);
    }
  });

  it("Leaderboard / Checklist / BigIdea / Pyramid / Venn / Cycle parse", () => {
    expect(validate("Leaderboard", { entries: [{ name: "A" }] }).success).toBe(true);
    expect(validate("Checklist", { items: [{ text: "a" }] }).success).toBe(true);
    expect(validate("BigIdea", { text: "less is more" }).success).toBe(true);
    expect(validate("PyramidDiagram", { levels: ["a"] }).success).toBe(true);
    expect(validate("VennDiagram", { sets: ["a", "b"] }).success).toBe(true);
    expect(validate("CycleDiagram", { stages: ["a", "b", "c"] }).success).toBe(true);
  });
});
