import { describe, expect, it } from "vitest";
import { storyboardSchema } from "./schema.js";

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
