import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveProjectDir } from "./project-path.js";

function seedProject(projectsDir: string, name: string): void {
  const dir = path.join(projectsDir, name);
  mkdirSync(path.join(dir, "storyboard"), { recursive: true });
  writeFileSync(path.join(dir, "storyboard", "storyboard.yaml"), "{}", "utf8");
}

describe("resolveProjectDir", () => {
  let base: string;
  let projectsDir: string;

  beforeAll(() => {
    base = mkdtempSync(path.join(tmpdir(), "vf-resolve-"));
    projectsDir = path.join(base, "projects");
    mkdirSync(projectsDir, { recursive: true });
    seedProject(projectsDir, "harness-engineering");
    seedProject(projectsDir, "长视频测试");
    seedProject(projectsDir, "harness-extra");
    // A non-project dir that must never match.
    mkdirSync(path.join(projectsDir, "not-a-project"), { recursive: true });
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("resolves the exact folder name", () => {
    const r = resolveProjectDir("harness-engineering", base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.root).toBe(path.join(projectsDir, "harness-engineering"));
  });

  it("resolves a human topic with spaces and capitals to its slug", () => {
    const r = resolveProjectDir("Harness Engineering", base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.root).toBe(path.join(projectsDir, "harness-engineering"));
  });

  it("is separator- and case-insensitive (underscore, mixed case)", () => {
    for (const arg of ["harness_engineering", "HARNESS-ENGINEERING"]) {
      const r = resolveProjectDir(arg, base);
      expect(r.ok).toBe(true);
    }
  });

  it("resolves CJK folder names verbatim and case-insensitively", () => {
    const r = resolveProjectDir("长视频测试", base);
    expect(r.ok).toBe(true);
  });

  it("resolves a unique prefix", () => {
    const r = resolveProjectDir("长视频", base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.root).toBe(path.join(projectsDir, "长视频测试"));
  });

  it("errors on an ambiguous prefix, listing the candidates", () => {
    const r = resolveProjectDir("harness", base);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/ambiguous/);
      expect(r.message).toContain("harness-engineering");
      expect(r.message).toContain("harness-extra");
    }
  });

  it("errors with the available-project listing on zero matches", () => {
    const r = resolveProjectDir("no-such-project", base);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("no project matching");
      expect(r.message).toContain("长视频测试");
    }
  });

  it("resolves a direct path to a project root", () => {
    const r = resolveProjectDir("./projects/harness-engineering", base);
    expect(r.ok).toBe(true);
  });

  it("rejects an empty argument", () => {
    expect(resolveProjectDir("   ", base).ok).toBe(false);
  });

  it("never matches a non-project directory", () => {
    const r = resolveProjectDir("not-a-project", base);
    expect(r.ok).toBe(false);
  });

  it("defaults cwd to process cwd and fails readably when projects/ is absent", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "vf-resolve-empty-"));
    try {
      const r = resolveProjectDir("anything", empty);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/vf new/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});