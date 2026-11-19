import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Command } from "commander";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import {
  chatWithFallback,
  extractFencedYaml,
  GLMProvider,
  loadProviderConfig,
  MiniMaxProvider,
} from "@video/llm";
import type { ChatMessage, Provider } from "@video/llm";
import { findRepoRoot } from "./learn-command.js";
import {
  loadBacklogStore,
  type BacklogEntry,
  type BacklogStatus,
} from "./backlog-store.js";

/**
 * Deterministic backlog scoring + the optional LLM judge (design §打分,
 * docs/plans/2026-11-18-backlog-feature-design.md).
 *
 * The deterministic score is the cheap default every `list` can afford: a
 * weighted sum of three components — recency 30, completeness 40,
 * readiness 30. The design's fourth component, overlap-cleanliness, is
 * deliberately NOT scored here: it needs the projects/<id>/article.md
 * keyword scan, which is filesystem I/O, and a score function must stay
 * pure and offline. Faking it with a constant would silently reshape the
 * ranking, so it is left out entirely and the other weights stand alone
 * at 100.
 *
 * `judge` is the real judgment a sum cannot make: ONE batched LLM call
 * ranks all open entries. The parsed reply is cached at
 * runs/backlog-judge-<sha256(sorted open ids+topics)>.yaml — as long as
 * the open set is unchanged, re-running is a cache hit and the LLM is
 * never called. The prompt carries id/topic/note (capped at 200
 * chars)/anchors, NEVER the full content: the judge ranks ideas, not
 * drafts, and content is an unbounded dump.
 */

// Weights — completeness parts must sum to COMPLETENESS_WEIGHT and the
// three weights to 100 (asserted by tests; scores are integers 0-100).
const RECENCY_WEIGHT = 30;
const COMPLETENESS_WEIGHT = 40;
const READINESS_WEIGHT = 30;
const RECENCY_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const COMPLETENESS_PARTS = { note: 15, anchors: 10, content: 15 } as const;

// idea = ready to pick this week; drafting = already in flight; proposed
// = needs an approve first; drafted/dropped are dead for picking.
const READINESS_SCORE: Record<BacklogStatus, number> = {
  idea: 30,
  drafting: 22,
  proposed: 15,
  drafted: 5,
  dropped: 0,
};

/** Unreadable dates must never look fresh: a broken `created` earns no
 *  recency credit instead of crashing the whole list. */
function recencyFactor(created: string, now: number): number {
  const createdMs = Date.parse(created);
  if (!Number.isFinite(createdMs)) return 0;
  const ageDays = Math.max(0, (now - createdMs) / DAY_MS);
  return Math.max(0, 1 - ageDays / RECENCY_WINDOW_DAYS);
}

function completenessScore(entry: BacklogEntry): number {
  let score = 0;
  if (entry.note !== undefined && entry.note.trim() !== "") {
    score += COMPLETENESS_PARTS.note;
  }
  if (entry.anchors !== undefined && entry.anchors.some((a) => a.trim() !== "")) {
    score += COMPLETENESS_PARTS.anchors;
  }
  if (entry.content !== undefined && entry.content.trim() !== "") {
    score += COMPLETENESS_PARTS.content;
  }
  return score;
}

/** Deterministic 0-100 priority. No I/O, no LLM, no hidden state — the
 *  same entry + the same `now` always yield the same integer. */
export function scoreBacklogEntry(
  entry: BacklogEntry,
  now: number = Date.now(),
): number {
  const recency = recencyFactor(entry.created, now) * RECENCY_WEIGHT;
  // completenessScore already returns weighted points capped at
  // COMPLETENESS_WEIGHT — no renormalization.
  const completeness = completenessScore(entry);
  return Math.round(recency + completeness + READINESS_SCORE[entry.status]);
}

/** Score desc, then created desc on ties, then the input order (stable
 *  sort — ES2019 guarantees it). Returns a new array; the caller's list
 *  order is never mutated. */
export function sortForList(
  ideas: BacklogEntry[],
  now: number = Date.now(),
): BacklogEntry[] {
  // Score each entry once: the comparator runs O(n log n) times and the
  // score touches four optional fields every call.
  const scores = new WeakMap<BacklogEntry, number>();
  const scoreOf = (e: BacklogEntry): number => {
    const cached = scores.get(e);
    if (cached !== undefined) return cached;
    const s = scoreBacklogEntry(e, now);
    scores.set(e, s);
    return s;
  };
  return [...ideas].sort((a, b) => {
    const byScore = scoreOf(b) - scoreOf(a);
    if (byScore !== 0) return byScore;
    return b.created.localeCompare(a.created);
  });
}

export interface JudgeRank {
  id: string;
  rank: number;
  reason: string;
}

export interface BacklogJudgeOptions {
  json?: boolean;
  model?: "minimax" | "glm";
  cwd?: string;
}

const JUDGE_CACHE_SCHEMA = "backlog-judge/1";
const NOTE_PROMPT_CAP = 200;
const JUDGE_CACHE_FILE = "backlog-judge";

interface JudgeCacheFile {
  schema: string;
  hash: string;
  provider: string;
  created: string;
  ranking: JudgeRank[];
}

/** Cache key = the open set itself: add/rename/reorder an entry and the
 *  hash moves; nothing else about the store (statuses of closed entries,
 *  notes, content) can invalidate a ranking of ids+topics. */
function openEntriesHash(open: BacklogEntry[]): string {
  const canonical = [...open]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => `${e.id}\n${e.topic}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

const JUDGE_SYSTEM_PROMPT = `You rank video topic ideas for a knowledge channel.
Decide which open backlog idea is most worth turning into a video next.
Judge story potential: a concrete hook, a tension or surprise, material the
channel has not covered — NOT how long or polished the note is.
Output STRICTLY one fenced yaml block shaped:

\`\`\`yaml
ranking:
  - id: <entry id>
    rank: <integer, 1 = most worth doing>
    reason: <one short line, the decisive factor>
\`\`\`

Rules:
- every id you are given appears EXACTLY once;
- ranks are unique integers;
- the reason states the decisive factor, it does not restate the topic.`;

function buildJudgeMessages(open: BacklogEntry[]): ChatMessage[] {
  const lines: string[] = ["Open backlog entries:", ""];
  for (const e of open) {
    lines.push(`- id: ${e.id}`);
    lines.push(`  topic: ${e.topic}`);
    if (e.note !== undefined && e.note.trim() !== "") {
      lines.push(`  note: ${e.note.trim().slice(0, NOTE_PROMPT_CAP)}`);
    }
    if (e.anchors !== undefined && e.anchors.length > 0) {
      lines.push(`  anchors: ${e.anchors.join(", ")}`);
    }
    // content is deliberately absent — see the module header.
  }
  lines.push("");
  lines.push(`Rank ALL ${open.length} entries now.`);
  return [
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n") },
  ];
}

/** Validate the judge reply against the open id set. Throws with a
 *  readable reason — the caller dumps the raw reply and exits 1
 *  (loud degradation, same convention as corrupt YAML). */
export function parseJudgeRanking(
  raw: string,
  expectedIds: string[],
): JudgeRank[] {
  const body = extractFencedYaml(raw);
  let parsed: unknown;
  try {
    parsed = parseYaml(body);
  } catch (err) {
    throw new Error(`judge reply is not valid YAML: ${(err as Error).message}`);
  }
  const ranking = (parsed as { ranking?: unknown } | null)?.ranking;
  if (!Array.isArray(ranking)) {
    throw new Error(`judge reply must be yaml with a top-level "ranking" list`);
  }
  const expected = new Set(expectedIds);
  const seenIds = new Set<string>();
  const seenRanks = new Set<number>();
  const out: JudgeRank[] = [];
  for (const [i, item] of ranking.entries()) {
    const row = item as { id?: unknown; rank?: unknown; reason?: unknown };
    if (typeof row.id !== "string" || !expected.has(row.id)) {
      throw new Error(
        `ranking[${i}].id ${JSON.stringify(row.id ?? null)} is not one of the open ids`,
      );
    }
    if (seenIds.has(row.id)) {
      throw new Error(`ranking lists "${row.id}" twice`);
    }
    const rank =
      typeof row.rank === "number"
        ? row.rank
        : typeof row.rank === "string" && row.rank.trim() !== ""
          ? Number(row.rank)
          : Number.NaN;
    if (!Number.isFinite(rank)) {
      throw new Error(`ranking[${i}].rank is not a number`);
    }
    if (seenRanks.has(rank)) {
      throw new Error(`rank ${rank} is used twice — ranks must be unique`);
    }
    seenIds.add(row.id);
    seenRanks.add(rank);
    out.push({
      id: row.id,
      rank,
      reason: typeof row.reason === "string" ? row.reason : "",
    });
  }
  const missing = [...expected].filter((id) => !seenIds.has(id));
  if (missing.length > 0) {
    throw new Error(`judge reply is missing ids: ${missing.join(", ")}`);
  }
  return out.sort((a, b) => a.rank - b.rank);
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unknown provider: ${name}`);
}

export async function runBacklogJudge(
  opts: BacklogJudgeOptions,
): Promise<number> {
  const repoRoot = findRepoRoot(opts.cwd ?? process.cwd());
  let store;
  try {
    store = loadBacklogStore(repoRoot);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
  const open = store.ideas.filter(
    (e) => e.status === "idea" || e.status === "proposed",
  );
  if (open.length === 0) {
    console.log(
      store.ideas.length === 0
        ? `backlog is empty — add ideas with \`video backlog add "<topic>"\``
        : `no open entries to judge — only idea/proposed entries are ranked (add or approve one first)`,
    );
    return 0;
  }

  const hash = openEntriesHash(open);
  // runs/backlog-judge-<hash>.yaml; an unparseable reply is dumped beside
  // it with a -failed suffix so the raw evidence survives the exit 1.
  const cachePath = path.join(repoRoot, "runs", `${JUDGE_CACHE_FILE}-${hash}.yaml`);
  const failedPath = cachePath.replace(/\.yaml$/, "-failed.yaml");

  let ranking: JudgeRank[] | null = null;
  let providerName = "unknown";
  let judgedAt = "";

  // Same open set as last time → reuse. A corrupt cache is a miss with a
  // warning, never a crash: it gets overwritten by the fresh judgment.
  if (existsSync(cachePath)) {
    try {
      const raw = parseYaml(readFileSync(cachePath, "utf8")) as
        | Partial<JudgeCacheFile>
        | null;
      const rows = raw?.ranking;
      const shapeOk =
        raw?.schema === JUDGE_CACHE_SCHEMA &&
        Array.isArray(rows) &&
        rows.every(
          (r) =>
            r !== null &&
            typeof r.id === "string" &&
            Number.isFinite(r.rank),
        );
      if (raw !== null && shapeOk && rows !== undefined) {
        console.log(
          `✓ judge cache hit — ${path.relative(repoRoot, cachePath)} (entries unchanged since ${raw.created ?? "unknown"})`,
        );
        ranking = rows;
        providerName = raw.provider ?? "unknown";
        judgedAt = raw.created ?? "";
      } else {
        console.error(`  ! judge cache unreadable — re-judging`);
      }
    } catch {
      console.error(`  ! judge cache unreadable — re-judging`);
    }
  }

  if (ranking === null) {
    const cfg = loadProviderConfig();
    const reviewCfg = cfg["review"];
    const chosenName = opts.model ?? reviewCfg.primary;
    const fallbackName =
      chosenName === reviewCfg.primary
        ? reviewCfg.fallback
        : chosenName === reviewCfg.fallback
          ? reviewCfg.primary
          : undefined;

    const messages = buildJudgeMessages(open);
    let rawReply = "";
    try {
      // Low temperature: a ranking should not shuffle between identical runs.
      const out = await chatWithFallback(
        providerInstance(chosenName),
        fallbackName !== undefined ? providerInstance(fallbackName) : null,
        { messages, temperature: 0.2 },
      );
      rawReply = out.response.content;
      providerName = out.provider;
      judgedAt = new Date().toISOString();
    } catch (err) {
      console.error(`✗ judge LLM call failed: ${(err as Error).message}`);
      return 1;
    }

    try {
      ranking = parseJudgeRanking(rawReply, open.map((e) => e.id));
    } catch (err) {
      mkdirSync(path.dirname(failedPath), { recursive: true });
      writeFileSync(failedPath, rawReply, "utf8");
      console.error(`✗ judge output unusable: ${(err as Error).message}`);
      console.error(`  raw reply dumped to ${path.relative(repoRoot, failedPath)}`);
      return 1;
    }

    mkdirSync(path.dirname(cachePath), { recursive: true });
    const record: JudgeCacheFile = {
      schema: JUDGE_CACHE_SCHEMA,
      hash,
      provider: providerName,
      created: judgedAt,
      ranking,
    };
    writeFileSync(cachePath, yamlStringify(record) + "\n", "utf8");
  }

  const rankById = new Map(ranking.map((r) => [r.id, r]));
  // flatMap only guards a hand-edited cache file missing an id; the
  // parser has already enforced full coverage for fresh judgments.
  const rows = open
    .flatMap((e) => {
      const r = rankById.get(e.id);
      return r === undefined
        ? []
        : [{ id: e.id, topic: e.topic, status: e.status, rank: r.rank, reason: r.reason }];
    })
    .sort((a, b) => a.rank - b.rank);

  if (opts.json === true) {
    console.log(
      JSON.stringify({
        schema: JUDGE_CACHE_SCHEMA,
        hash,
        provider: providerName,
        judged_at: judgedAt,
        ranking: rows,
      }),
    );
    return 0;
  }

  console.log(`✓ judge ranking of ${rows.length} open entries (${providerName}):`);
  for (const row of rows) {
    const reason = row.reason.replace(/\s+/g, " ").trim() || "(no reason given)";
    console.log(`  ${row.rank}. ${row.id}  ${row.topic} — ${reason}`);
  }
  console.log(`  cache: ${path.relative(repoRoot, cachePath)}`);
  return 0;
}

export function addJudgeCommand(backlog: Command): void {
  backlog
    .command("judge")
    .description(
      "one batched LLM ranking of the open ideas, cached by ids+topics hash (runs/backlog-judge-<hash>.yaml)",
    )
    .option("--json", "machine-readable output (full ranked object)")
    .option("--model <provider>", "model provider: minimax|glm (default from config)")
    .option("--cwd <dir>", "repo root (default: walk up to pnpm-workspace.yaml)")
    .action(async (opts: { json?: boolean; model?: string; cwd?: string }) => {
      process.exitCode = await runBacklogJudge({
        ...(opts.json === true ? { json: true } : {}),
        ...(opts.model !== undefined
          ? { model: opts.model as "minimax" | "glm" }
          : {}),
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      });
    });
}
