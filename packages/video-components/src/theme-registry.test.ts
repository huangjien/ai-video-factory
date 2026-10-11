import { describe, expect, it } from "vitest";
import {
  THEME_NAMES,
  THEMES,
  darkTechTheme,
  isValidTheme,
  paperLightTheme,
  resolveTheme,
} from "./theme.js";

describe("theme registry (v0.2 themes)", () => {
  it("ships at least four choices", () => {
    expect(THEME_NAMES.length).toBeGreaterThanOrEqual(4);
    expect(THEME_NAMES).toContain("dark-tech");
    expect(THEME_NAMES).toContain("paper-light");
    expect(THEME_NAMES).toContain("ocean-deep");
    expect(THEME_NAMES).toContain("dusk-warm");
  });

  it("ships the four v0.4 additions (forest-moss, sunset-pop, terminal-vintage, paper-cream)", () => {
    expect(THEME_NAMES).toContain("forest-moss");
    expect(THEME_NAMES).toContain("sunset-pop");
    expect(THEME_NAMES).toContain("terminal-vintage");
    expect(THEME_NAMES).toContain("paper-cream");
    // Strict `toBe(8)` removed: post-v0.4 additions (e.g. ai-red)
    // legitimately grow the registry. The new theme is covered by its own
    // `it` below; accidental removals are still caught because the
    // explicit `toContain`s above fail if any of the four disappear.
    expect(THEME_NAMES.length).toBeGreaterThanOrEqual(8);
  });

  it("every theme carries the full token set", () => {
    for (const name of THEME_NAMES) {
      expect(isValidTheme(THEMES[name]), `${name} is not a valid theme`).toBe(
        true,
      );
    }
  });

  it("every theme keeps primary text readable on its own background", () => {
    // Luma-contrast smoke: primary must differ from background by a wide
    // margin, otherwise text is invisible.
    const luma = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    for (const name of THEME_NAMES) {
      const t = THEMES[name]!;
      const spread = Math.abs(luma(t.colors.primary) - luma(t.colors.background));
      expect(spread, `${name} primary/background luma spread`).toBeGreaterThan(120);
    }
  });

  it("resolveTheme defaults to paper-light for unknown/missing names (v0.4.3)", () => {
    expect(resolveTheme(undefined)).toBe(paperLightTheme);
    expect(resolveTheme(null)).toBe(paperLightTheme);
    expect(resolveTheme("")).toBe(paperLightTheme);
    expect(resolveTheme("tyypo")).toBe(paperLightTheme);
    // Explicit names still win.
    expect(resolveTheme("dark-tech")).toBe(darkTechTheme);
    expect(resolveTheme("paper-light")).toBe(THEMES["paper-light"]);
  });

  it("resolveTheme finds every v0.4 addition", () => {
    expect(resolveTheme("forest-moss")).toBe(THEMES["forest-moss"]);
    expect(resolveTheme("sunset-pop")).toBe(THEMES["sunset-pop"]);
    expect(resolveTheme("terminal-vintage")).toBe(THEMES["terminal-vintage"]);
    expect(resolveTheme("paper-cream")).toBe(THEMES["paper-cream"]);
  });

  it("terminal-vintage uses JetBrains Mono across all roles", () => {
    const t = THEMES["terminal-vintage"]!;
    expect(t.fonts.title).toBe("JetBrains Mono");
    expect(t.fonts.body).toBe("JetBrains Mono");
    expect(t.fonts.code).toBe("JetBrains Mono");
  });

  it("ships the ai-red (creator/playback) theme", () => {
    const t = THEMES["ai-red"];
    expect(t).toBeDefined();
    expect(resolveTheme("ai-red")).toBe(t);
    // Signature red accent over the player-dark surface.
    expect(t!.colors.accent).toBe("#FF0000");
    expect(t!.colors.background).toBe("#0F0F0F");
    expect(t!.colors.primary).toBe("#FFFFFF");
  });
});
