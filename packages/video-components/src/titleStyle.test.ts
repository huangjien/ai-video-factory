import { describe, expect, it } from "vitest";
import {
  isLightInk,
  luma,
  titleFontSize,
  titleInk,
  titleWidthUnits,
  wantsVerticalTitle,
} from "./titleStyle.js";
import { darkTechTheme, paperLightTheme } from "./theme.js";

describe("the title card's ink", () => {
  it("takes dark ink on a paper-bright picture", () => {
    // The ink-on-paper card's art measures 214 in the band its type
    // covers — that is a sheet of paper, so the type is ink on it.
    expect(titleInk(paperLightTheme, 214)).toBe(paperLightTheme.colors.primary);
  });

  it("takes light ink on a darker picture", () => {
    // The brush column's art measures 156 in its strip — a scene, not
    // paper, so light ink reads on it.
    expect(titleInk(paperLightTheme, 156)).toBe(
      paperLightTheme.colors.background,
    );
  });

  it("falls back to the theme's own ink without art", () => {
    expect(titleInk(paperLightTheme, null)).toBe(paperLightTheme.colors.primary);
  });

  it("flips with the theme, not with a hardcoded colour", () => {
    // The dark theme's surface is the dark ink, its text colour is the
    // light one.
    expect(titleInk(darkTechTheme, 214)).toBe(darkTechTheme.colors.background);
    expect(titleInk(darkTechTheme, 156)).toBe(darkTechTheme.colors.primary);
  });

  it("reads luma the way the eye does", () => {
    expect(luma("#000000")).toBe(0);
    expect(luma("#FFFFFF")).toBeCloseTo(255, 0);
    expect(luma("not-a-colour")).toBe(0);
    expect(isLightInk("#F5F1E8")).toBe(true);
    expect(isLightInk("#1F1D1A")).toBe(false);
  });
});

describe("the title card's type size", () => {
  it("sets a short headline at the display size", () => {
    expect(titleFontSize([..."弃书"], 1920, 1080, false)).toBe(96);
  });

  it("sets a long headline smaller instead of wrapping it", () => {
    const long = titleFontSize([..."弃书不是题材太小而是节奏不对"], 1920, 1080, false);
    expect(long).toBeLessThan(96);
    expect(long).toBeGreaterThanOrEqual(40);
  });

  it("fits a vertical column to the frame height", () => {
    expect(titleFontSize([..."玄武门之变"], 1920, 1080, true)).toBe(132);
    expect(titleFontSize([..."一"], 1920, 1080, true)).toBe(132);
    const many = titleFontSize([..."一二三四五六七八九十"], 1920, 1080, true);
    expect(many).toBeLessThan(132);
  });

  it("counts a CJK glyph as a whole em and a Latin glyph as half", () => {
    expect(titleWidthUnits([..."弃书"])).toBeCloseTo(2, 5);
    expect(titleWidthUnits([..."ab"])).toBeCloseTo(1.1, 5);
  });
});

describe("the vertical column", () => {
  it("is for CJK only", () => {
    expect(wantsVerticalTitle("玄武门之变")).toBe(true);
    expect(wantsVerticalTitle("Seven Wrong Calls")).toBe(false);
  });
});
