import { describe, expect, it } from "vitest";
import { REGISTRY } from "./registry.js";

/** LLM outputs drift around strict schemas — alias preprocessing plus
 *  `.passthrough()` let the renderer survive the drift instead of
 *  failing a whole video. These tests pin that behavior for the
 *  components that still ship (v0.12 removed the structured/diagram
 *  components — see docs/v0.11-decision-provider-plan.md). */
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

  it("EndCard accepts cta_text/cta_url/disclaimer (alias for cta + ignore)", () => {
    const r = validate("EndCard", {
      title: "Sub",
      cta_text: "Subscribe",
      cta_url: "https://example.com",
      disclaimer: "not a field",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.cta).toBe("Subscribe");
    }
  });

  it("rejects a component missing its required text", () => {
    expect(validate("Title", { subtitle: "no text" }).success).toBe(false);
    expect(validate("Paragraph", { align: "left" }).success).toBe(false);
  });
});
