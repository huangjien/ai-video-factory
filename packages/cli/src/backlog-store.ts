import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import { slugifyProjectName } from "./project-path.js";

/**
 * `backlog.yaml` — the repo-root idea store (design:
 * docs/plans/2026-11-18-backlog-feature-design.md). The ONLY stored
 * state is this file; scores, ordering and stats are derived at read
 * time and never written back.
 */

export const BACKLOG_SCHEMA = "backlog/1";
export const BACKLOG_FILE = "backlog.yaml";

export type BacklogStatus =
  | "proposed"
  | "idea"
  | "drafting"
  | "drafted"
  | "dropped";

export const BACKLOG_STATUSES: BacklogStatus[] = [
  "proposed",
  "idea",
  "drafting",
  "drafted",
  "dropped",
];

export interface BacklogEntry {
  /** Stable slug, never reused: `<yyyy-mm-dd>-<topic-slug>`. */
  id: string;
  topic: string;
  note?: string;
  /** Research anchors (people, places, systems) feeding the overlap scan. */
  anchors?: string[];
  /** Optional long-form context (brainstorm/research dump). Passed to the
   *  drafter as supplementary context via `--from-backlog`; no size cap. */
  content?: string;
  status: BacklogStatus;
  /** Backfilled with the project slug once a draft succeeds. */
  project?: string;
  /** "manual" | "harvest:<relpath>" */
  source: string;
  /** yyyy-mm-dd */
  created: string;
  /** When the entry entered `drafting` — drives stale-drafting warnings. */
  drafting_at?: string;
  /** Why the idea was dropped (`video backlog drop --reason`). */
  drop_reason?: string;
  /** When the draft succeeded. */
  drafted_at?: string;
  lang?: "zh-CN" | "en-US";
}

export interface BacklogStore {
  schema: string;
  ideas: BacklogEntry[];
}

export function backlogPath(repoRoot: string): string {
  return path.join(repoRoot, BACKLOG_FILE);
}

/**
 * Load the store. A MISSING file reads as empty (read verbs report
 * nothing; write verbs init). A CORRUPT file throws with path + parser
 * message — it is never silently rewritten (design: fail fast).
 */
export function loadBacklogStore(repoRoot: string): BacklogStore {
  const file = backlogPath(repoRoot);
  if (!existsSync(file)) return { schema: BACKLOG_SCHEMA, ideas: [] };
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${file} is malformed: ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error(`${file} is malformed: expected a YAML mapping at top level`);
  }
  const store = parsed as Partial<BacklogStore>;
  if (store.schema !== BACKLOG_SCHEMA) {
    throw new Error(
      `${file}: unsupported schema ${String(store.schema)} (expected ${BACKLOG_SCHEMA})`,
    );
  }
  if (store.ideas !== undefined && !Array.isArray(store.ideas)) {
    throw new Error(`${file} is malformed: "ideas" must be a list`);
  }
  const ideas = (store.ideas ?? []).map((raw, index): BacklogEntry => {
    const e = raw as Partial<BacklogEntry>;
    if (typeof e.id !== "string" || e.id === "") {
      throw new Error(`${file} is malformed: ideas[${index}] has no id`);
    }
    if (typeof e.topic !== "string" || e.topic.trim() === "") {
      throw new Error(`${file} is malformed: ideas[${index}] (${e.id}) has no topic`);
    }
    if (!BACKLOG_STATUSES.includes(e.status as BacklogStatus)) {
      throw new Error(
        `${file} is malformed: ideas[${index}] (${e.id}) has unknown status ${String(e.status)}` +
          ` — expected one of ${BACKLOG_STATUSES.join("|")}`,
      );
    }
    return { ...(e as BacklogEntry), status: e.status as BacklogStatus };
  });
  return { schema: BACKLOG_SCHEMA, ideas };
}

/** Write the store back. Callers own the read-modify-write cycle
 *  (single-user convention, last writer wins — same as state.yaml). */
export function saveBacklogStore(repoRoot: string, store: BacklogStore): void {
  writeFileSync(backlogPath(repoRoot), yamlStringify(store) + "\n", "utf8");
}

/** Guarantee the file exists before a write verb mutates it. */
export function initBacklogStore(repoRoot: string): BacklogStore {
  const store = loadBacklogStore(repoRoot);
  if (!existsSync(backlogPath(repoRoot))) saveBacklogStore(repoRoot, store);
  return store;
}

export function loadBacklogEntry(
  repoRoot: string,
  id: string,
): BacklogEntry | undefined {
  return loadBacklogStore(repoRoot).ideas.find((e) => e.id === id);
}

/** `<yyyy-mm-dd>-<slug>`, deduped with -2/-3 suffixes; ids never reused. */
export function nextBacklogId(
  topic: string,
  ideas: BacklogEntry[],
  today: string,
): string {
  const base = `${today}-${slugifyProjectName(topic)}`;
  const taken = new Set(ideas.map((e) => e.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const TRANSITIONS: Record<BacklogStatus, BacklogStatus[]> = {
  proposed: ["idea", "dropped"],
  idea: ["drafting", "dropped"],
  drafting: ["drafted", "dropped"],
  drafted: [],
  dropped: [],
};

export function canTransition(
  from: BacklogStatus,
  to: BacklogStatus,
  viaReset = false,
): boolean {
  if (viaReset && from === "drafting" && to === "idea") return true;
  return TRANSITIONS[from].includes(to);
}

/** Throw a readable error instead of returning a flag — callers are CLI
 *  verbs that want to print why the transition is illegal. */
export function assertTransition(
  entry: BacklogEntry,
  to: BacklogStatus,
  viaReset = false,
): void {
  if (!canTransition(entry.status, to, viaReset)) {
    throw new Error(
      `cannot move "${entry.id}" ${entry.status} → ${to}` +
        (viaReset ? "" : ` — legal from ${entry.status}: ${TRANSITIONS[entry.status].join("|") || "(none)"}`),
    );
  }
}

const STALE_DRAFTING_MS = 24 * 60 * 60 * 1000;

/** A crash mid `draft --from-backlog` leaves `drafting` behind. Older
 *  than a day = almost certainly stale; verbs warn and `reset` is the
 *  manual escape. */
export function isStaleDrafting(entry: BacklogEntry, now = Date.now()): boolean {
  if (entry.status !== "drafting" || entry.drafting_at === undefined) return false;
  const started = Date.parse(entry.drafting_at);
  return Number.isFinite(started) && now - started > STALE_DRAFTING_MS;
}
