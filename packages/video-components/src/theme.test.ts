import { describe, expect, it } from "vitest";
import { COMPONENT_NAMES, REGISTRY } from "./registry.js";
import { darkTechTheme } from "./theme.js";
import { fade, slide, scale, draw, typewriter } from "./animations.js";

describe("Todo 7 — theme tokens", () => {
  it("dark-tech palette is concrete and contrast-safe (primary on background >= 7:1)", () => {
    const relLum = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const lin = (v: number) =>
        v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const a = relLum(darkTechTheme.colors.background);
    const b = relLum(darkTechTheme.colors.primary);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    expect(ratio).toBeGreaterThan(7);
  });

  it("registry exports exactly the 10 v0.1 components", () => {
    expect(COMPONENT_NAMES.sort()).toEqual(
      [
        "Callout",
        "CodeBlock",
        "Comparison",
        "EndCard",
        "FlowChart",
        "Image",
        "Paragraph",
        "Terminal",
        "Timeline",
        "Title",
      ].sort(),
    );
  });

  it("animation helpers return interpolated values within expected ranges", () => {
    expect(fade(0)).toBeCloseTo(0, 2);
    expect(fade(30)).toBeCloseTo(1, 1);
    expect(slide(0, "left").translate).toBeLessThan(0);
    expect(slide(60, "left").translate).toBe(0);
    expect(scale(0)).toBeLessThan(1);
    expect(scale(60)).toBeCloseTo(1, 1);
    expect(draw(0)).toBeCloseTo(0, 2);
    expect(draw(60)).toBeCloseTo(1, 2);
    expect(typewriter(0, "AI")).toBe("");
    expect(typewriter(100, "AI").length).toBeGreaterThan(0);
  });

  it("REGISTRY has a zod propsSchema for every component", () => {
    for (const name of COMPONENT_NAMES) {
      const entry = REGISTRY[name];
      expect(entry?.propsSchema).toBeDefined();
      expect(entry?.propsSchema.safeParse({}).success).toBe(false);
    }
  });
});
