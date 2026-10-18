import { describe, expect, it } from "vitest";
import { THEME_NAMES, DEFAULT_THEME_NAME } from "@video/video-components";
import {
  ADVANCED_VERBS,
  MINIMAL_API_COMMANDS,
  buildBanner,
} from "./minimal-api.js";

describe("MINIMAL_API_COMMANDS / ADVANCED_VERBS data", () => {
  it("every recommended row is a video invocation with a purpose", () => {
    expect(MINIMAL_API_COMMANDS.length).toBeGreaterThan(4);
    for (const row of MINIMAL_API_COMMANDS) {
      expect(row.invocation.startsWith("video ")).toBe(true);
      expect(row.purpose.length).toBeGreaterThan(10);
    }
  });

  it("covers the four banner steps", () => {
    const invocations = MINIMAL_API_COMMANDS.map((c) => c.invocation);
    expect(invocations.some((i) => i.startsWith("video new"))).toBe(true);
    expect(invocations.some((i) => i.startsWith("video draft"))).toBe(true);
    expect(invocations.some((i) => i.startsWith("video make"))).toBe(true);
  });

  it("advanced verbs are unique and lowercase", () => {
    expect(new Set(ADVANCED_VERBS).size).toBe(ADVANCED_VERBS.length);
    for (const v of ADVANCED_VERBS) expect(v).toMatch(/^[a-z-]+$/);
  });
});

describe("buildBanner", () => {
  const banner = buildBanner("0.4");

  it("carries the version and the four-command pitch", () => {
    expect(banner).toContain("v0.4");
    expect(banner).toContain("video new <topic>");
    expect(banner).toContain("video draft <topic>");
    expect(banner).toContain("video approve storyboard");
    expect(banner).toContain("video make <topic>");
  });

  it("lists every theme from the registry, default first", () => {
    for (const name of THEME_NAMES) {
      expect(banner).toContain(name);
    }
    expect(banner.indexOf(DEFAULT_THEME_NAME)).toBeLessThan(
      banner.indexOf("dark-tech"),
    );
  });

  it("lists every advanced verb", () => {
    for (const verb of ADVANCED_VERBS) {
      expect(banner).toContain(verb);
    }
    // The banner wraps at 78 cols and the closing phrase can split across
    // lines — compare on whitespace-normalized text.
    expect(banner.replace(/\s+/g, " ")).toContain(
      "not part of the recommended path",
    );
  });

  it("keeps every line within a terminal-friendly width", () => {
    for (const line of banner.split("\n")) {
      // CJK-heavy theme presets line uses the ─ rule width as the budget.
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it("no stray double blank lines", () => {
    expect(banner).not.toContain("\n\n\n");
  });
});

describe("buildBanner — determinism + doc safety", () => {
  it("is deterministic across calls", () => {
    expect(buildBanner("0.4")).toBe(buildBanner("0.4"));
  });

  it("uses the version string verbatim", () => {
    expect(buildBanner("9.9")).toContain("v9.9");
  });

  it("joins the theme list with the middle-dot separator", () => {
    expect(buildBanner("0.4")).toContain(" · ");
  });

  it("command purposes are single-line (README table cell safety)", () => {
    for (const row of MINIMAL_API_COMMANDS) {
      expect(row.purpose).not.toMatch(/\n/);
      expect(row.invocation).not.toMatch(/\n/);
    }
  });
});
