import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runBacklogStatus } from "./backlog-status.js";
import { acquireAutoLock, releaseAutoLock } from "./backlog-auto.js";
import { loadBacklogStore, saveBacklogStore, type BacklogEntry } from "./backlog-store.js";

let repoRoot: string;
let out: string[];
const origLog = console.log;
const NOW = Date.parse("2026-11-19T12:00:00Z");

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), "video-backlog-status-"));
  out = [];
  console.log = (...a: unknown[]) => out.push(a.join(" "));
});
afterEach(() => {
  console.log = origLog;
  rmSync(repoRoot, { recursive: true, force: true });
});

function seed(partial: Partial<BacklogEntry>): BacklogEntry {
  const store = loadBacklogStore(repoRoot);
  const entry: BacklogEntry = {
    id: "2026-11-19-top",
    topic: "为什么停火线能冻结几十年",
    status: "proposed",
    source: "manual",
    created: "2026-11-19",
    ...partial,
  };
  store.ideas.push(entry);
  saveBacklogStore(repoRoot, store);
  return entry;
}

function autoRecord(status: string, error?: string, ageMin = 10): void {
  const runs = path.join(repoRoot, "runs");
  mkdirSync(runs, { recursive: true });
  const f = path.join(runs, `backlog-auto-2026-11-19T${String(10 + ageMin).padStart(2, "0")}:00:00Z-001.yaml`);
  writeFileSync(
    f,
    `stage: backlog-auto\nstatus: ${status}\nprovider: glm\n${error !== undefined ? `error: ${error}\n` : ""}`,
  );
  utimesSync(f, new Date(NOW - ageMin * 60 * 1000), new Date(NOW - ageMin * 60 * 1000));
}

describe("runBacklogStatus", () => {
  it("reports an idle scheduler, no lock, nothing in progress", async () => {
    const code = await runBacklogStatus({ cwd: repoRoot, plistDir: path.join(repoRoot, "LA"), runLaunchctl: async () => 0 });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toMatch(/scheduler: not installed/);
    expect(text).toMatch(/auto run: idle/);
    expect(text).toMatch(/in progress: nothing/);
  });

  it("shows a live lock as a running pipeline", async () => {
    acquireAutoLock(repoRoot, NOW);
    await runBacklogStatus({ cwd: repoRoot, plistDir: path.join(repoRoot, "LA"), runLaunchctl: async () => 0 });
    releaseAutoLock(repoRoot);
    expect(out.join("\n")).toMatch(/lock present \(pid/);
  });

  it("derives the stage checklist and continue command for a half-produced idea", async () => {
    const drafted = seed({ status: "drafted", project: "为什么停火线能冻结几十年" });
    const zhRoot = path.join(repoRoot, "projects", "为什么停火线能冻结几十年");
    mkdirSync(path.join(zhRoot, "output"), { recursive: true });
    writeFileSync(path.join(zhRoot, "article.md"), "# 停火线\n");
    writeFileSync(path.join(zhRoot, "output", "final-mixed.mp4"), "mp4");

    await runBacklogStatus({ cwd: repoRoot, plistDir: path.join(repoRoot, "LA"), runLaunchctl: async () => 0 });

    const text = out.join("\n");
    expect(text).toMatch(/draft-zh ✓/);
    expect(text).toMatch(/make-zh ✓/);
    expect(text).toMatch(/translate-en ✗/);
    expect(text).toMatch(/make-en ✗/);
    expect(text).toMatch(/→ continue: video translate 为什么停火线能冻结几十年 en-US/);
    void drafted;
  });

  it("lists failed auto runs with their detail", async () => {
    seed({});
    autoRecord("failed", "make-zh failed (exit 1) — resume or reset", 30);
    await runBacklogStatus({ cwd: repoRoot, plistDir: path.join(repoRoot, "LA"), runLaunchctl: async () => 0 });
    const text = out.join("\n");
    expect(text).toMatch(/failed runs/);
    expect(text).toMatch(/make-zh failed \(exit 1\)/);
  });

  it("notes a stale drafting entry with the reset escape", async () => {
    seed({ status: "drafting", drafting_at: new Date(NOW - 30 * 60 * 60 * 1000).toISOString() });
    await runBacklogStatus({ cwd: repoRoot, plistDir: path.join(repoRoot, "LA"), runLaunchctl: async () => 0 });
    const text = out.join("\n");
    expect(text).toMatch(/STALE >24h/);
    expect(text).toMatch(/video backlog reset 2026-11-19-top/);
  });
});
