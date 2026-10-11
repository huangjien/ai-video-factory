import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  paint,
  themeIndex,
  themeDetail,
  themeFromProject,
  runTheme,
} from "./theme-command.js";

/**
 * Tests for the pure formatters in `theme-command.ts`. The runner
 * (`runTheme`) only does I/O — it is covered indirectly via the formatter
 * tests, which exercise every code path the runner will hit.
 */

let savedColor: string | undefined;
beforeAll(() => {
  // Strip ANSI for deterministic assertions.
  savedColor = process.env["NO_COLOR"];
  process.env["NO_COLOR"] = "1";
});
afterAll(() => {
  if (savedColor === undefined) delete process.env["NO_COLOR"];
  else process.env["NO_COLOR"] = savedColor;
});

describe("paint", () => {
  it("returns plain text when NO_COLOR is set", () => {
    expect(paint("#FF0000", "X")).toBe("X");
  });
  it("returns plain text for malformed hex", () => {
    expect(paint("not-a-color", "X")).toBe("X");
  });
});

describe("themeIndex", () => {
  it("lists every registered theme by name", () => {
    const out = themeIndex();
    for (const name of [
      "dark-tech",
      "paper-light",
      "ocean-deep",
      "dusk-warm",
      "forest-moss",
      "sunset-pop",
      "terminal-vintage",
      "paper-cream",
      "ai-red",
    ]) {
      expect(out).toContain(name);
    }
  });
  it("advertises the correct theme count in the header", () => {
    const out = themeIndex();
    // Header reads: "▷ themes · 9 available  ·  index"
    expect(out).toMatch(/themes · 9 available/);
  });
  it("does NOT emit ANSI when NO_COLOR is set", () => {
    expect(themeIndex()).not.toContain("\x1b[");
  });
});

describe("themeDetail", () => {
  it("shows every color row for a known theme", () => {
    const out = themeDetail("ai-red");
    expect(out).toContain("background");
    expect(out).toContain("surface");
    expect(out).toContain("primary");
    expect(out).toContain("secondary");
    expect(out).toContain("accent");
    expect(out).toContain("warning");
    expect(out).toContain("success");
    // Signature red must be visible to the operator.
    expect(out).toContain("#FF0000");
    expect(out).toContain("#0F0F0F");
  });
  it("warns loudly for an unknown theme name", () => {
    const out = themeDetail("nope-this-is-not-a-theme");
    expect(out).toContain("Unknown theme");
    // Must surface the available list so the operator can pick.
    expect(out).toContain("ai-red");
  });
  it("falls back gracefully when called with no name", () => {
    // resolveTheme(undefined) → paperLightTheme; the output must still
    // contain every color row.
    const out = themeDetail("");
    expect(out).toContain("background");
    // resolveTheme("") returns paper-light (the v0.4.3 default) — and
    // since "" is not a key in THEMES, detail labels it "unknown" while
    // still showing the palette. Either way the test must not crash.
    expect(out.length).toBeGreaterThan(50);
  });
});

describe("themeFromProject", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "theme-cmd-"));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("reports missing storyboard.yaml clearly", () => {
    const empty = path.join(tmp, "no-storyboard");
    mkdirSync(empty, { recursive: true });
    const out = themeFromProject(empty);
    expect(out).toContain("No storyboard found");
  });

  it("resolves style.theme from a real storyboard.yaml", () => {
    const project = path.join(tmp, "p");
    mkdirSync(path.join(project, "storyboard"), { recursive: true });
    writeFileSync(
      path.join(project, "storyboard", "storyboard.yaml"),
      `schema_version: "0.2"\nproject: {id: p, language: zh-CN, fps: 30, width: 1920, height: 1080}\nstyle:\n  theme: ai-red\nscenes: []\n`,
    );
    const out = themeFromProject(project);
    expect(out).toContain("ai-red");
    expect(out).toContain("#FF0000");
  });

  it("defaults to paper-light when style.theme is unset", () => {
    const project = path.join(tmp, "no-theme");
    mkdirSync(path.join(project, "storyboard"), { recursive: true });
    writeFileSync(
      path.join(project, "storyboard", "storyboard.yaml"),
      `schema_version: "0.2"\nproject: {id: no-theme, language: zh-CN, fps: 30, width: 1920, height: 1080}\nscenes: []\n`,
    );
    const out = themeFromProject(project);
    expect(out).toContain("paper-light");
    expect(out).toContain("defaulting");
  });
});

describe("runTheme", () => {
  it("returns exit 1 for an unknown theme name", () => {
    // Captures console.log via the test runner; we only assert exit code.
    // (Direct console.log assertions would require stubbing — kept out of
    // scope to keep this surgical.)
    const savedLog = console.log;
    console.log = () => {};
    try {
      const code = runTheme({ name: "definitely-not-a-theme" });
      expect(code).toBe(1);
    } finally {
      console.log = savedLog;
    }
  });
  it("returns exit 0 for a known theme name", () => {
    const savedLog = console.log;
    console.log = () => {};
    try {
      const code = runTheme({ name: "ai-red" });
      expect(code).toBe(0);
    } finally {
      console.log = savedLog;
    }
  });
});
