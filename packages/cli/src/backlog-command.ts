import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { findRepoRoot } from "./learn-command.js";
import {
  assertTransition,
  initBacklogStore,
  isStaleDrafting,
  loadBacklogStore,
  nextBacklogId,
  saveBacklogStore,
  type BacklogEntry,
  type BacklogStore,
  type BacklogStatus,
} from "./backlog-store.js";
import { scanOverlap } from "./backlog-overlap.js";
import { sortForList } from "./backlog-score.js";
import { addHarvestCommand } from "./backlog-harvest.js";
import { addStatsCommand } from "./backlog-stats.js";
import { addScheduleCommand } from "./backlog-schedule.js";
import { addJudgeCommand } from "./backlog-score.js";
import { addAutoCommand } from "./backlog-auto.js";

/**
 * `video backlog` — the idea store (design:
 * docs/plans/2026-11-18-backlog-feature-design.md).
 *
 *   video backlog add "<topic>"     store an idea (overlap preflight)
 *   video backlog list              what could be made next
 *   video backlog approve/drop/reset
 *   video draft --from-backlog <id> pick an idea → draft (see backlog-draft.ts)
 *   video backlog harvest / stats / score / schedule (sibling files)
 */

export interface BacklogAddOptions {
  topic: string;
  note?: string;
  anchors?: string[];
  contentFile?: string;
  lang?: "zh-CN" | "en-US";
  force?: boolean;
  cwd?: string;
}

/** Local yyyy-mm-dd — ids are day-scoped, not UTC-scoped. */
export function backlogToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function entryLine(e: BacklogEntry): string {
  const bits = [`${e.status}`, e.source];
  if (e.project !== undefined) bits.push(`→ ${e.project}`);
  if (e.drop_reason !== undefined) bits.push(`(dropped: ${e.drop_reason})`);
  return `${e.id}  ${e.topic}  [${bits.join(", ")}]`;
}

function findEntryOrReport(store: BacklogStore, id: string): BacklogEntry | null {
  const entry = store.ideas.find((e) => e.id === id);
  if (entry !== undefined) return entry;
  const available = store.ideas.map((e) => e.id).join(", ") || "(none)";
  console.error(`✗ no backlog entry "${id}" — ids: ${available}`);
  return null;
}

/** Shared read-modify-write: load, locate, transition, mutate, save. */
function mutateEntry(
  repoRoot: string,
  id: string,
  mutate: (entry: BacklogEntry) => void,
): number {
  let store: BacklogStore;
  try {
    store = initBacklogStore(repoRoot);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
  const entry = findEntryOrReport(store, id);
  if (entry === null) return 1;
  try {
    mutate(entry);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
  saveBacklogStore(repoRoot, store);
  console.log(`✓ ${entry.id} — ${entryLine(entry)}`);
  return 0;
}

export async function runBacklogAdd(opts: BacklogAddOptions): Promise<number> {
  const repoRoot = findRepoRoot(opts.cwd ?? process.cwd());
  let content: string | undefined;
  if (opts.contentFile !== undefined) {
    const p = path.resolve(opts.contentFile);
    if (!existsSync(p)) {
      console.error(`--content-file not found: ${p}`);
      return 1;
    }
    content = readFileSync(p, "utf8");
    if (content.trim() === "") {
      console.error(`--content-file is empty: ${p}`);
      return 1;
    }
  }

  // Overlap preflight: soft gate, --force overrules (design §CLI).
  const hits = scanOverlap(repoRoot, {
    topic: opts.topic,
    ...(opts.note !== undefined ? { note: opts.note } : {}),
    ...(opts.anchors !== undefined ? { anchors: opts.anchors } : {}),
    ...(content !== undefined ? { content } : {}),
  });
  if (hits.length > 0 && opts.force !== true) {
    console.error(
      `✗ overlap with the existing catalog — re-run with --force to add anyway:`,
    );
    for (const hit of hits) {
      console.error(
        `  ${hit.project}: matched ${hit.keywords.slice(0, 5).map((k) => `"${k}"`).join(", ")}`,
      );
    }
    return 1;
  }
  if (hits.length > 0) {
    console.log(
      `  ! ${hits.length} overlap warning(s) overridden by --force (first: ${hits[0]?.project})`,
    );
  }

  const store = initBacklogStore(repoRoot);
  const entry: BacklogEntry = {
    id: nextBacklogId(opts.topic, store.ideas, backlogToday()),
    topic: opts.topic.trim(),
    status: "idea",
    source: "manual",
    created: backlogToday(),
    ...(opts.note !== undefined ? { note: opts.note } : {}),
    ...(opts.anchors !== undefined && opts.anchors.length > 0
      ? { anchors: opts.anchors }
      : {}),
    ...(content !== undefined ? { content } : {}),
    ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
  };
  store.ideas.push(entry);
  saveBacklogStore(repoRoot, store);
  console.log(`✓ added ${entry.id}`);
  console.log(`  ${entryLine(entry)}`);
  return 0;
}

export interface BacklogListOptions {
  status?: BacklogStatus;
  json?: boolean;
  all?: boolean;
  cwd?: string;
}

export async function runBacklogList(opts: BacklogListOptions): Promise<number> {
  const repoRoot = findRepoRoot(opts.cwd ?? process.cwd());
  const store = loadBacklogStore(repoRoot);
  const visible = store.ideas.filter((e) => {
    if (opts.all === true) return true;
    if (opts.status !== undefined) return e.status === opts.status;
    return e.status !== "dropped";
  });
  // Score desc (BL-05, deterministic only); ties break on recency.
  const sorted = sortForList(visible);
  if (opts.json === true) {
    console.log(JSON.stringify({ schema: store.schema, ideas: sorted }));
    return 0;
  }
  for (const e of sorted) {
    if (isStaleDrafting(e)) {
      console.log(
        `  ! ${e.id} stuck in drafting since ${e.drafting_at} — reset it with \`video backlog reset ${e.id}\``,
      );
    }
  }
  if (sorted.length === 0) {
    console.log(
      store.ideas.length === 0
        ? "backlog is empty — add ideas with `video backlog add \"<topic>\"`"
        : "no entries in this view — `--all` shows dropped ones too",
    );
    return 0;
  }
  for (const e of sorted) console.log(entryLine(e));
  return 0;
}

export async function runBacklogApprove(opts: {
  id: string;
  cwd?: string;
}): Promise<number> {
  const repoRoot = findRepoRoot(opts.cwd ?? process.cwd());
  return mutateEntry(repoRoot, opts.id, (entry) => {
    assertTransition(entry, "idea");
    entry.status = "idea";
  });
}

export async function runBacklogDrop(opts: {
  id: string;
  reason?: string;
  cwd?: string;
}): Promise<number> {
  const repoRoot = findRepoRoot(opts.cwd ?? process.cwd());
  return mutateEntry(repoRoot, opts.id, (entry) => {
    assertTransition(entry, "dropped");
    entry.status = "dropped";
    if (opts.reason !== undefined) entry.drop_reason = opts.reason;
  });
}

export async function runBacklogReset(opts: {
  id: string;
  cwd?: string;
}): Promise<number> {
  const repoRoot = findRepoRoot(opts.cwd ?? process.cwd());
  return mutateEntry(repoRoot, opts.id, (entry) => {
    assertTransition(entry, "idea", true);
    entry.status = "idea";
    delete entry.drafting_at;
  });
}

export function registerBacklog(program: Command): void {
  const backlog = program
    .command("backlog")
    .description(
      "idea backlog — store topic ideas, harvest candidates, pick one to draft (docs/plans/2026-11-18-backlog-feature-design.md)",
    );

  backlog
    .command("add")
    .argument("<topic>", "the video topic, e.g. \"为什么停火线能冻结几十年\"")
    .option("--note <text>", "one-line mechanism summary")
    .option(
      "--anchor <kw>",
      "research anchor — people, places, systems (repeatable)",
      (kw: string, prev: string[] | undefined) => [...(prev ?? []), kw],
    )
    .option(
      "--content-file <path>",
      "path to a long-form note/brainstorm stored as the entry's content",
    )
    .option("--lang <lang>", "preferred narration language: zh-CN|en-US")
    .option(
      "--force",
      "add despite overlap warnings from the existing-catalog scan",
    )
    .option("--cwd <dir>", "repo root (default: walk up to pnpm-workspace.yaml)")
    .action(async (topic: string, opts) => {
      process.exitCode = await runBacklogAdd({
        topic,
        ...(opts.note !== undefined ? { note: opts.note } : {}),
        ...(opts.anchor !== undefined ? { anchors: opts.anchor } : {}),
        ...(opts.contentFile !== undefined
          ? { contentFile: opts.contentFile }
          : {}),
        ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
        ...(opts.force === true ? { force: true } : {}),
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      });
    });

  backlog
    .command("list")
    .option("--status <status>", "filter: proposed|idea|drafting|drafted|dropped")
    .option("--json", "machine-readable output")
    .option("--all", "include dropped entries")
    .option("--cwd <dir>")
    .action(async (opts) => {
      process.exitCode = await runBacklogList({
        ...(opts.status !== undefined ? { status: opts.status as BacklogStatus } : {}),
        ...(opts.json === true ? { json: true } : {}),
        ...(opts.all === true ? { all: true } : {}),
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      });
    });

  const withId = (name: string, description: string) =>
    backlog
      .command(name)
      .argument("<id>", "backlog entry id")
      .description(description)
      .option("--cwd <dir>");

  withId("approve", "proposed → idea (accept a harvested suggestion)").action(
    async (id: string, opts) => {
      process.exitCode = await runBacklogApprove({
        id,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      });
    },
  );

  withId("drop", "give up on an idea")
    .option("--reason <text>", "why it is dropped (recorded on the entry)")
    .action(async (id: string, opts) => {
      process.exitCode = await runBacklogDrop({
        id,
        ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      });
    });

  withId(
    "reset",
    "stuck drafting → idea (crash recovery for --from-backlog)",
  ).action(async (id: string, opts) => {
    process.exitCode = await runBacklogReset({
      id,
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    });
  });

  // Sibling modules own their flags and runners; the parent only mounts
  // them under `video backlog` so the verb stays one --help block.
  addHarvestCommand(backlog);
  addStatsCommand(backlog);
  addScheduleCommand(backlog);
  addJudgeCommand(backlog);
  addAutoCommand(backlog);
}
