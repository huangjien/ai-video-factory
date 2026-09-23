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
