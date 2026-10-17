import { describe, expect, it } from "vitest";
import { coerceAnimationEntrance, storyboardSchema } from "./schema.js";

describe("VDSL storyboardSchema with LLM enum synonyms", () => {
  const validProject = {
    id: "t",
    language: "zh-CN",
    fps: 30,
    width: 1920,
    height: 1080,
  };

  it("canonical animation entrance values pass", () => {
    const r = storyboardSchema.safeParse({
      schema_version: "0.1",
      project: validProject,
      scenes: [
        {
          id: "s1",
          duration: 5,
          visual: { component: "Title", props: {} },
          animation: { entrance: "fade" },
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("coerces LLM synonyms for animation.entrance", () => {
    for (const llmValue of [
      "slide-up",
      "bounce",
      "slide-in",
      "fade-in",
      "zoom",
    ]) {
      const r = storyboardSchema.safeParse({
        schema_version: "0.1",
        project: validProject,
        scenes: [
          {
            id: "s1",
            duration: 5,
            visual: { component: "Title", props: {} },
            animation: { entrance: llmValue },
          },
        ],
      });
      expect(r.success).toBe(true);
    }
  });

  it("coerces LLM synonyms for animation.exit", () => {
    for (const llmValue of ["fade-out"]) {
      const r = storyboardSchema.safeParse({
        schema_version: "0.1",
        project: validProject,
        scenes: [
          {
            id: "s1",
            duration: 5,
            visual: { component: "Title", props: {} },
            animation: { exit: llmValue },
          },
        ],
      });
      expect(r.success).toBe(true);
    }
  });

  it("coerces LLM synonyms for captions.source", () => {
    for (const llmValue of ["script", "voice", "auto", "narration-subtitle"]) {
      const r = storyboardSchema.safeParse({
        schema_version: "0.1",
        project: validProject,
        scenes: [
          {
            id: "s1",
            duration: 5,
            visual: { component: "Title", props: {} },
            captions: { source: llmValue },
          },
        ],
      });
      expect(r.success).toBe(true);
    }
  });

  it("coerces LLM synonyms for transition.in/out (cut/fade are strict; LLM unlikely to invent here)", () => {
    for (const value of ["cut", "fade"]) {
      const r = storyboardSchema.safeParse({
        schema_version: "0.1",
        project: validProject,
        scenes: [
          {
            id: "s1",
            duration: 5,
            visual: { component: "Title", props: {} },
            transition: { in: value, out: value },
          },
        ],
      });
      expect(r.success).toBe(true);
    }
  });

  it("rejects truly unparseable enum values (the schema must still catch bugs)", () => {
    const r = storyboardSchema.safeParse({
      schema_version: "0.1",
      project: validProject,
      scenes: [
        {
          id: "s1",
          duration: 5,
          visual: { component: "Title", props: {} },
          animation: { entrance: "unicorn-effect" },
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});

// Regression: found by `video prompts eval --judge glm` on 2026-10-18. GLM
// asked for a direction on nearly every entrance, and one unknown qualifier
// discarded the whole storyboard — a live `video storyboard` failure, not
// only an eval problem. See docs/v0.10-prompt-evals-plan.md §8 gap 2.
describe("directional animation.entrance synonyms", () => {
  it("accepts the exact values GLM emitted", () => {
    for (const llmValue of [
      "slide-left",
      "slide-right",
      "slide_left",
      "slide-in-both-sides",
      "zoom-out",
    ]) {
      expect(coerceAnimationEntrance(llmValue), llmValue).toMatch(
        /^(slide|scale)$/,
      );
    }
  });

  it("maps each cluster to its canonical value", () => {
    expect(coerceAnimationEntrance("slide-left")).toBe("slide");
    expect(coerceAnimationEntrance("slide_right")).toBe("slide");
    expect(coerceAnimationEntrance("slide-in-from-bottom")).toBe("slide");
    expect(coerceAnimationEntrance("zoom-out")).toBe("scale");
    expect(coerceAnimationEntrance("scale-down")).toBe("scale");
    expect(coerceAnimationEntrance("fade-from-top")).toBe("fade");
    expect(coerceAnimationEntrance("wipe-across-screen")).toBe("draw");
  });

  it("normalizes case, spaces, and underscores the same way as the table", () => {
    for (const raw of ["Slide-Left", "SLIDE LEFT", "  slide_left  "]) {
      expect(coerceAnimationEntrance(raw), raw).toBe("slide");
    }
  });

  it("survives a full storyboard parse, not just the coercer", () => {
    const r = storyboardSchema.safeParse({
      schema_version: "0.1",
      project: {
        id: "t",
        language: "zh-CN",
        fps: 30,
        width: 1920,
        height: 1080,
      },
      scenes: [
        {
          id: "s1",
          duration: 5,
          visual: { component: "Title", props: {} },
          animation: { entrance: "slide-left" },
        },
        {
          id: "s2",
          duration: 5,
          visual: { component: "Title", props: {} },
          animation: { entrance: "zoom-out" },
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("still rejects a non-directional qualifier — the bug guard survives", () => {
    // The point of the qualifier allow-list: accepting any trailing words
    // would turn the schema into a rubber stamp.
    for (const bad of [
      "slide-banana",
      "zoom-explode",
      "fade-into-a-banana",
      "unicorn-effect",
    ]) {
      expect(() => coerceAnimationEntrance(bad), bad).toThrow(
        /unknown animation.entrance/,
      );
    }
  });

  it("accepts a directional qualifier spelled with spaces", () => {
    // Normalization runs before the qualifier split, so "slide from left"
    // is the same value as "slide-from-left".
    expect(coerceAnimationEntrance("slide from left")).toBe("slide");
  });

  it("does not let a mangled typewriter animation become something else", () => {
    expect(() => coerceAnimationEntrance("typewriter-from-left")).toThrow(
      /unknown animation.entrance/,
    );
  });

  it("maps bare vertical-translate verbs onto slide", () => {
    // Observed as "rise" on 2026-10-18. These carry no directional
    // qualifier, so they need the table, not stripDirectionalQualifiers.
    for (const v of ["rise", "rise-up", "lift", "elevate", "ascend"]) {
      expect(coerceAnimationEntrance(v), v).toBe("slide");
    }
  });
});
