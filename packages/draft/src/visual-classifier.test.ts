import { describe, expect, it } from "vitest";
import { REGISTRY } from "@video/video-components";
import {
  DEFAULT_VISUAL_COMPONENT,
  ROUTABLE_COMPONENTS,
  pickVisualComponent,
} from "./visual-classifier.js";

describe("pickVisualComponent (v0.12 — structured routing removed)", () => {
  it("forces the first scene to the Title card", () => {
    expect(pickVisualComponent("anything at all", true).component).toBe("Title");
  });

  it("routes every later scene directly to its image", () => {
    expect(
      pickVisualComponent("a serene lake at sunset", false).component,
    ).toBe(DEFAULT_VISUAL_COMPONENT);
    expect(
      pickVisualComponent("流水线 步骤 流程 图", false).component,
    ).toBe(DEFAULT_VISUAL_COMPONENT);
  });

  it("routes a keyword-heavy structural line the same way", () => {
    expect(
      pickVisualComponent("流程：第一步采集，第二步清洗，第三步入库", false)
        .component,
    ).toBe(DEFAULT_VISUAL_COMPONENT);
  });

  it("does not register or route AnimatedIllustration", () => {
    expect(REGISTRY).not.toHaveProperty("AnimatedIllustration");
    expect(ROUTABLE_COMPONENTS).not.toContain("AnimatedIllustration");
  });

  it("only offers components that exist in the registry", () => {
    for (const name of ROUTABLE_COMPONENTS) {
      expect(REGISTRY[name as keyof typeof REGISTRY]).toBeDefined();
    }
  });
});
