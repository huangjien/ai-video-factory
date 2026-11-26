import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { saveBacklogStore, type BacklogEntry } from "./backlog-store.js";
import {
  addStatsCommand,
  deriveBacklogStats,
  runBacklogStats,
} from "./backlog-stats.js";

let repoRoot = "";
let consoleOutput: string[];
let consoleErrors: string[];
const origLog = console.log;
const origErr = console.error;

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), "video-backlog-stats-"));
  consoleOutput = [];
  consoleErrors = [];
  console.log = (...a: unknown[]) => consoleOutput.push(a.join(" "));
  console.error = (...a: unknown[]) => consoleErrors.push(a.join(" "));
});
afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  rmSync(repoRoot, { recursive: true, force: true });
});

function entry(
  overrides: Partial<BacklogEntry> & { id: string },
): BacklogEntry {
  return {
    topic: overrides.id,
    status: "idea",
    source: "manual",
    created: "2026-11-18",
    ...overrides,
  };
}

/** Build the project-tree evidence for a given tier. */
function makeProject(slug: string, tier: "drafted" | "rendered" | "published") {
  const root = path.join(repoRoot, "projects", slug);
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "article.md"), "x");
  if (tier === "drafted") return;
  mkdirSync(path.join(root, "output"), { recursive: true });
  writeFileSync(path.join(root, "output", "final-mixed.mp4"), "x");
  if (tier === "rendered") return;
  mkdirSync(path.join(root, "bilibili"), { recursive: true });
  writeFileSync(path.join(root, "bilibili", "bvid.txt"), "BV1x");
}

function writeIdeas(ideas: BacklogEntry[]): void {
  saveBacklogStore(repoRoot, {
    schema: "backlog/1",
    ideas,
  });
}

describe("deriveBacklogStats", () => {
  it("assigns the highest tier each project tree supports", () => {
    makeProject("a", "drafted");
    makeProject("b", "rendered");
    makeProject("c", "published");
    const stats = deriveBacklogStats(repoRoot, [
      entry({ id: "1", project: "a" }),
      entry({ id: "2", project: "b" }),
      entry({ id: "3", project: "c" }),
    ]);
    expect(stats.counts).toEqual({
      none: 0,
      drafted: 1,
      rendered: 1,
      published: 1,
    });
    expect(stats.drafted).toEqual([
      { id: "1", tier: "drafted", project: "a" },
      { id: "2", tier: "rendered", project: "b" },
      { id: "3", tier: "published", project: "c" },
    ]);
    expect(stats.total).toBe(3);
    expect(stats.anomalies).toEqual([]);
  });

  it("entries without a project count as none", () => {
    const stats = deriveBacklogStats(repoRoot, [entry({ id: "x" })]);
    expect(stats.counts.none).toBe(1);
    expect(stats.drafted).toEqual([]);
  });

  it("missing project dir counts as none", () => {
    const stats = deriveBacklogStats(repoRoot, [
      entry({ id: "x", project: "ghost" }),
    ]);
    expect(stats.counts.none).toBe(1);
  });

  it("flags drafted-status entries with no project or missing dir", () => {
    const stats = deriveBacklogStats(repoRoot, [
      entry({ id: "np", status: "drafted" }),
      entry({ id: "gone", status: "drafted", project: "deleted" }),
    ]);
    expect(stats.anomalies).toEqual([
      { id: "np", reason: "status drafted but no project set" },
      { id: "gone", reason: "status drafted but projects dir missing" },
    ]);
  });

  it("groups harvest:<path> sources under harvest", () => {
    const stats = deriveBacklogStats(repoRoot, [
      entry({ id: "1", source: "manual" }),
      entry({ id: "2", source: "harvest:notes/rn.md" }),
      entry({ id: "3", source: "harvest:notes/other.md" }),
    ]);
    expect(stats.bySource).toEqual({ manual: 1, harvest: 2 });
  });
});

describe("runBacklogStats", () => {
  it("prints counts and exits 0", async () => {
    makeProject("a", "published");
    writeIdeas([entry({ id: "1", project: "a", status: "drafted" })]);
    const code = await runBacklogStats({ cwd: repoRoot });
    expect(code).toBe(0);
    expect(consoleOutput.join("\n")).toContain("backlog entries: 1");
    expect(consoleOutput.join("\n")).toContain("published: 1");
    expect(consoleOutput.join("\n")).toContain("1  published  a");
  });

  it("warns on stderr for hygiene anomalies", async () => {
    writeIdeas([entry({ id: "np", status: "drafted" })]);
    mkdirSync(path.join(repoRoot, "projects"));
    await runBacklogStats({ cwd: repoRoot });
    expect(consoleErrors.join("\n")).toContain("np");
  });

  it("--json dumps the derived object", async () => {
    makeProject("a", "rendered");
    writeIdeas([
      entry({ id: "1", project: "a", source: "harvest:notes/rn.md" }),
    ]);
    await runBacklogStats({ cwd: repoRoot, json: true });
    const parsed = JSON.parse(consoleOutput.join("")) as {
      total: number;
      counts: Record<string, number>;
      bySource: { manual: number; harvest: number };
      drafted: { id: string; tier: string }[];
      anomalies: unknown[];
    };
    expect(parsed.total).toBe(1);
    expect(parsed.counts.rendered).toBe(1);
    expect(parsed.bySource).toEqual({ manual: 0, harvest: 1 });
    expect(parsed.drafted).toEqual([
      { id: "1", tier: "rendered", project: "a" },
    ]);
    expect(parsed.anomalies).toEqual([]);
  });

  it("empty backlog exits 0 with a friendly message", async () => {
    mkdirSync(path.join(repoRoot, "projects"));
    const code = await runBacklogStats({ cwd: repoRoot });
    expect(code).toBe(0);
    expect(consoleOutput.join("\n")).toContain("backlog is empty");
  });

  it("missing projects dir exits 0 with a friendly message", async () => {
    const code = await runBacklogStats({ cwd: repoRoot });
    expect(code).toBe(0);
    expect(consoleOutput.join("\n")).toContain("no projects/");
  });

  it("registers a stats subcommand with --json", async () => {
    makeProject("a", "drafted");
    writeIdeas([entry({ id: "1", project: "a" })]);
    const backlog = new Command("backlog");
    addStatsCommand(backlog);
    await backlog.parseAsync(["stats", "--json", "--cwd", repoRoot], {
      from: "user",
    });
    const parsed = JSON.parse(consoleOutput.join("")) as { total: number };
    expect(parsed.total).toBe(1);
  });
});
