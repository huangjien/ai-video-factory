import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Command } from "commander";
import { findRepoRoot } from "./learn-command.js";
import { slugifyProjectName } from "./project-path.js";
import { isStaleDrafting, loadBacklogStore, type BacklogEntry } from "./backlog-store.js";
import { schedulerState, type BacklogScheduleOptions } from "./backlog-schedule.js";

/**
 * `video backlog status` — one screen answering: is anything running, did
 * anything fail, and where does each produced/in-flight idea stand, so a
 * human (or the next agent turn) knows exactly how to continue.
 *
 * Everything is DERIVED: the store, project artifacts and runs/ records —
 * nothing here writes.
 */

export interface BacklogStatusOptions {
  cwd?: string;
  /** TEST SEAMS passed through to the scheduler query. */
  plistDir?: string;
  runLaunchctl?: (args: string[]) => Promise<number>;
}

interface EntryProgress {
  entry: BacklogEntry;
  /** Stage checklist for produced/in-flight ideas. */
  stages: { label: string; done: boolean }[];
  /** The next command to run to move this entry forward. */
  next: string;
}

function entryProgress(repoRoot: string, entry: BacklogEntry): EntryProgress {
  const slug = entry.project ?? slugifyProjectName(entry.topic);
  const zhRoot = path.join(repoRoot, "projects", slug);
  const zhMp4 = path.join(zhRoot, "output", "final-mixed.mp4");
  const enRoot = path.join(zhRoot, "l10n", "en-US");
  const enMp4 = path.join(enRoot, "output", "final-mixed.mp4");
  const enArticle = path.join(enRoot, "article.md");
  const bvid = path.join(zhRoot, "bilibili", "bvid.txt");

  const draftZh = entry.status === "drafted" || existsSync(path.join(zhRoot, "article.md"));
  const makeZh = existsSync(zhMp4);
  const translate = existsSync(enArticle);
  const makeEn = existsSync(enMp4);
  const published = existsSync(path.join(zhRoot, "bilibili", "bvid.txt"));

  const stages = [
    { label: "draft-zh", done: draftZh },
    { label: "make-zh", done: makeZh },
    { label: "translate-en", done: translate },
    { label: "make-en", done: makeEn },
    { label: "publish", done: published },
  ];

  let next: string;
  if (published) {
    next = "done — nothing to continue";
  } else if (!makeZh) {
    next = `video make ${slug}`;
  } else if (!translate) {
    next = `video translate ${slug} en-US`;
  } else if (!makeEn) {
    next = `video make ${slug} --lang en-US`;
  } else {
    next = `upload by hand (bilibili: python3 scripts/bilibili-upload.py ${slug}; zhihu: 创作中心)`;
  }
  return { entry, stages, next };
}

interface AutoRecord {
  file: string;
  mtime: number;
  status?: string | undefined;
  error?: string | undefined;
}

/** Newest backlog-auto run records (the tick log the launchd agent and
 *  manual runs write) — newest first, capped. */
function recentAutoRecords(repoRoot: string, cap: number): AutoRecord[] {
  const dir = path.join(repoRoot, "runs");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    // per-run records only — backlog-auto-<date>.yaml is the launchd
    // stdout log (raw text, not a record)
    .filter((f) => /^backlog-auto-\d{4}-\d{2}-\d{2}T.*-\d{3}\.yaml$/.test(f))
    .map((f) => {
      const full = path.join(dir, f);
      return { file: f, full, mtime: statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, cap);
  const out: AutoRecord[] = [];
  for (const { file, full, mtime } of files) {
    try {
      const parsed = parseYaml(readFileSync(full, "utf8")) as {
        status?: string;
        error?: string;
      } | null;
      out.push({ file, mtime, status: parsed?.status, error: parsed?.error });
    } catch {
      // unreadable record — still worth listing by name
      out.push({ file, mtime });
    }
  }
  return out;
}

function failedJudgeDumps(repoRoot: string): string[] {
  const dir = path.join(repoRoot, "runs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^backlog-judge-.*-failed\.yaml$/.test(f));
}

export async function runBacklogStatus(opts: BacklogStatusOptions): Promise<number> {
  const repoRoot = findRepoRoot(opts.cwd ?? process.cwd());
  console.log("backlog status");

  // 1. scheduler
  const sched = await schedulerState({
    kind: "auto",
    cwd: repoRoot,
    ...(opts.plistDir !== undefined ? { plistDir: opts.plistDir } : {}),
    ...(opts.runLaunchctl !== undefined ? { runLaunchctl: opts.runLaunchctl } : {}),
  });
  const schedLabel =
    sched.kind === "auto" ? "nightly 01:00/03:00/05:00 auto-producer" : "weekly harvest";
  console.log(
    `scheduler: ${sched.installed ? `installed (${sched.loaded ? "loaded" : "NOT loaded"})` : "not installed"} — ${schedLabel}`,
  );

  // 2. live lock — a pid can die mid-pipeline (LLM stream cut, reboot),
  // leaving drafting + lock behind; say which it is, not just that the
  // file exists.
  const lockPath = path.join(repoRoot, "runs", "backlog-auto.lock");
  if (existsSync(lockPath)) {
    let lockLine = "auto run: unreadable lock — see runs/backlog-auto.lock";
    try {
      const raw = parseYaml(readFileSync(lockPath, "utf8")) as { pid?: number } | null;
      const pid = raw?.pid;
      if (typeof pid !== "number") {
        lockLine = "auto run: lock present (no pid recorded)";
      } else {
        let alive = true;
        try {
          process.kill(pid, 0);
        } catch {
          alive = false;
        }
        lockLine = alive
          ? `auto run: RUNNING (pid ${pid})`
          : `auto run: owner pid ${pid} is DEAD — lock is stale; the next fire takes it over, or delete runs/backlog-auto.lock now`;
      }
    } catch {
      /* keep default line */
    }
    console.log(lockLine);
  } else {
    console.log("auto run: idle (no lock)");
  }

  let store;
  try {
    store = loadBacklogStore(repoRoot);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }

  // 3. in-progress + produced-with-gaps entries
  let inProgressCount = 0;
  for (const entry of store.ideas) {
    if (entry.status === "drafting") {
      const stale = isStaleDrafting(entry);
      console.log(
        `⏳ in progress: ${entry.id} [drafting${stale ? ", STALE >24h" : ""}]` +
          (stale ? ` → resume the failed stage or \`video backlog reset ${entry.id}\`` : ""),
      );
      inProgressCount++;
      continue;
    }
    if (entry.status !== "drafted") continue;
    const progress = entryProgress(repoRoot, entry);
    if (progress.stages.every((s) => s.done)) continue;
    const marks = progress.stages.map((s) => `${s.label} ${s.done ? "✓" : "✗"}`).join("  ");
    console.log(`⏳ in progress: ${progress.entry.id}  ${marks}`);
    console.log(`   → continue: ${progress.next}`);
    inProgressCount++;
  }
  if (inProgressCount === 0) {
    console.log("in progress: nothing — every produced idea is complete");
  }

  // 4. failed runs (newest first, cap 5)
  const records = recentAutoRecords(repoRoot, 6);
  const failures = records.filter(
    (r) => r.status === "failed" || (r.error ?? "").includes("failed"),
  );
  if (failures.length > 0) {
    console.log("failed runs (newest first):");
    for (const r of failures.slice(0, 5)) {
      console.log(`  ✗ ${r.file} — ${r.error ?? "(no detail)"}`);
    }
  }
  const judgeDumps = failedJudgeDumps(repoRoot);
  if (judgeDumps.length > 0) {
    console.log(
      `  ! ${judgeDumps.length} judge reply dump(s) in runs/ — the retry path handled them; delete when done reading`,
    );
  }
  if (records.length > 0 && failures.length === 0) {
    const newest = records[0]!;
    console.log(`recent run: ${newest.status ?? "?"} — ${newest.error ?? "(clean)"}`);
  }

  return 0;
}

export function addStatusCommand(backlog: Command): void {
  backlog
    .command("status")
    .description(
      "is anything running / failed / in progress — with the exact continue command (scheduler, live lock, per-entry stage checklist, failed runs)",
    )
    .option("--cwd <dir>", "repo root (default: walk up to pnpm-workspace.yaml)")
    .option("--plist-dir <dir>", "TEST SEAM: LaunchAgents dir override")
    .action(async (opts: { cwd?: string; plistDir?: string }) => {
      process.exitCode = await runBacklogStatus({
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.plistDir !== undefined ? { plistDir: opts.plistDir } : {}),
      });
    });
}
