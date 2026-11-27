import path from "node:path";
import type { Command } from "commander";
import { parse as parseYaml } from "yaml";
import {
  chatWithFallback,
  extractFencedYaml,
  GLMProvider,
  loadProviderConfig,
  MiniMaxProvider,
  quoteColonScalars,
} from "@video/llm";
import type { ChatMessage, Provider } from "@video/llm";
import { runBacklogJudgeExperiment } from "./backlog-judge-experiment.js";
import { findRepoRoot } from "./learn-command.js";
import {
  loadBacklogStore,
  type BacklogEntry,
  type BacklogStatus,
} from "./backlog-store.js";
import {
  expectedJudgeIds,
  JUDGE_CACHE_SCHEMA,
  judgeCachePath,
  judgeFingerprint,
  judgeRoute,
  latestAnalyticsReport,
  makeJudgeCacheRecord,
  readJudgeCache,
  removeLegacyJudgeCaches,
  validCachedRanking,
  writeJudgeCache,
  type JudgeRank,
} from "./backlog-judge-cache.js";

export { latestAnalyticsReport } from "./backlog-judge-cache.js";
export type { JudgeRank } from "./backlog-judge-cache.js";

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
 * ranks all open entries. The parsed reply is cached in the single rolling
 * runs/backlog-judge.yaml snapshot and validated against every prompt input.
 * The prompt carries id/topic/note (capped at 200
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
  if (
    entry.anchors !== undefined &&
    entry.anchors.some((a) => a.trim() !== "")
  ) {
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

export interface BacklogJudgeOptions {
  json?: boolean;
  model?: "minimax" | "glm";
  cwd?: string;
}

const NOTE_PROMPT_CAP = 200;

const JUDGE_SYSTEM_PROMPT = `You rank video topic ideas for a knowledge channel.
Decide which open backlog idea is most worth turning into a video next.
Judge story potential: a concrete hook, a tension or surprise, material the
channel has not covered — NOT how long or polished the note is.
When the prompt includes REAL viewing data from the channel, use it: ideas
in topic spaces that demonstrably overperform deserve a bump, ideas in
spaces the audience ignored deserve a discount — and the reason must name
which evidence drove that call. Read the data for what it is:
- views say what was CLICKED; engagement (likes, comments, coins,
  favorites) says what the audience VALUED. A lane with high engagement and
  few views is an appetite the channel has not reached yet — a bump, not a
  discount.
- judge a topic on the platform and format where it is actually watched;
  the digest's first line says which. Low numbers where nothing is watched
  are not a verdict on the topic.
- fewer than three videos, or videos younger than three days, is not a
  trend: read it as a signal of size, and say so in the reason.
Output STRICTLY one fenced yaml block shaped:

\`\`\`yaml
ranking:
  - n: <entry number, copied VERBATIM from the list below>
    rank: <integer, 1 = most worth doing>
    reason: <one short line, the decisive factor>
\`\`\`

Rules:
- identify entries ONLY by their number n — never retype ids or topics;
- every number you are given appears EXACTLY once;
- ranks are unique integers;
- the reason states the decisive factor, it does not restate the topic.`;

const REPORT_PROMPT_CAP = 6000;

/** The retry's conversation: the task, the reply that was rejected, and
 *  the parser's complaint about it — the model cannot fix what it is not
 *  told. */
function retryTurns(
  messages: ChatMessage[],
  reply: string,
  complaint: string | undefined,
  count: number,
): ChatMessage[] {
  if (complaint === undefined) return messages;
  return [
    ...messages,
    ...(reply === "" ? [] : [{ role: "assistant" as const, content: reply }]),
    {
      role: "user",
      content: `That reply was rejected: ${complaint}. Answer again in the SAME yaml shape. List all ${count} entries: every number n from 1 to ${count} EXACTLY once, and each rank from 1 to ${count} exactly once.`,
    },
  ];
}

/** The part of the report the judge reads: its digest and its topic-lane
 *  table, whole. Everything after is per-video lists the digest already
 *  summarized, and cutting the report at a character count landed
 *  mid-table — with the full report in the prompt the model listed one
 *  entry twice on both attempts (2026-11-25).
 *
 *  The cut is at the FIRST numbered section after the lane table — "## 2."
 *  in a report with the supply section, "## 3." in one without. Both the
 *  supply table and the per-video lists stay out of the judge's prompt:
 *  how many ideas are waiting is not evidence about any one of them. A
 *  report with no numbered section at all is read up to the cap. */
export function evidenceExcerpt(content: string): string {
  const cut = content.search(/^## [2-9]\. /m);
  return (cut === -1 ? content : content.slice(0, cut)).slice(
    0,
    REPORT_PROMPT_CAP,
  );
}

function buildJudgeMessages(
  open: BacklogEntry[],
  report?: { date: string; content: string },
  produced?: { topic: string; project?: string }[],
): ChatMessage[] {
  const lines: string[] = ["Open backlog entries:", ""];
  for (const [i, e] of open.entries()) {
    lines.push(`- n: ${i + 1}`);
    lines.push(`  topic: ${e.topic}`);
    if (e.note !== undefined && e.note.trim() !== "") {
      lines.push(`  note: ${e.note.trim().slice(0, NOTE_PROMPT_CAP)}`);
    }
    if (e.anchors !== undefined && e.anchors.length > 0) {
      lines.push(`  anchors: ${e.anchors.join(", ")}`);
    }
    // content is deliberately absent — see the module header.
  }
  if (produced !== undefined && produced.length > 0) {
    lines.push("");
    lines.push(
      "ALREADY PRODUCED by this channel (do not re-tell these stories):",
    );
    for (const p of produced) {
      lines.push(
        `- ${p.topic}${p.project !== undefined ? ` (project: ${p.project})` : ""}`,
      );
    }
    lines.push(
      "An open idea that retells one of these gets the LAST ranks with reason 'story already told' — unless it is a genuinely different angle, in which case say what is new.",
    );
  }
  if (report !== undefined) {
    lines.push("");
    lines.push(
      `REAL viewing data for this channel (analytics report ${report.date}): views/day, ENGAGEMENT (likes, comments, coins, favorites), topic lanes, length, Shorts vs long-form, Chinese vs English — both platforms. It opens with a ranked digest; read that before the tables:`,
    );
    lines.push(evidenceExcerpt(report.content));
  }
  lines.push("");
  lines.push(`Rank ALL ${open.length} entries now.`);
  return [
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n") },
  ];
}

/** Validate the judge reply against the open id set. Entries are
 *  identified by their POSITION NUMBER n (1-based, same order as
 *  expectedIds) — a 40-char truncated slug invited the model to retype
 *  ids and fail; small integers do not mangle. An exact `id` is still
 *  accepted for reply shape robustness. Throws with a readable reason —
 *  the caller dumps the raw reply and exits 1 (loud degradation, same
 *  convention as corrupt YAML). */
export function parseJudgeRanking(
  raw: string,
  expectedIds: string[],
): JudgeRank[] {
  const body = extractFencedYaml(raw);
  let parsed: unknown;
  try {
    parsed = parseYaml(body);
  } catch (err) {
    // A reason that carries prose ("…: …") is not valid YAML. The
    // repair quotes the offending value and reads it again; if that
    // fails too, the original complaint is the honest one to report.
    try {
      parsed = parseYaml(quoteColonScalars(body));
    } catch {
      throw new Error(
        `judge reply is not valid YAML: ${(err as Error).message}`,
      );
    }
  }
  const ranking = (parsed as { ranking?: unknown } | null)?.ranking;
  if (!Array.isArray(ranking)) {
    throw new Error(`judge reply must be yaml with a top-level "ranking" list`);
  }
  const expected = new Set(expectedIds);
  const seenIds = new Set<string>();
  const seenRanks = new Set<number>();
  const duplicated: string[] = [];
  const out: JudgeRank[] = [];
  for (const [i, item] of ranking.entries()) {
    const row = item as {
      id?: unknown;
      n?: unknown;
      rank?: unknown;
      reason?: unknown;
    };
    let id: string;
    if (typeof row.n === "number" || typeof row.n === "string") {
      const pos = Number(row.n);
      if (!Number.isInteger(pos) || pos < 1 || pos > expectedIds.length) {
        throw new Error(
          `ranking[${i}].n ${JSON.stringify(row.n ?? null)} is not a position between 1 and ${expectedIds.length}`,
        );
      }
      id = expectedIds[pos - 1]!;
    } else if (typeof row.id === "string" && expected.has(row.id)) {
      id = row.id;
    } else {
      throw new Error(
        `ranking[${i}] has neither a valid position n nor an exact open id (${JSON.stringify(row.id ?? row.n ?? null)})`,
      );
    }
    if (seenIds.has(id)) {
      // Reported at the end, next to what the duplication left out: "X
      // twice and Y missing" is what a retry needs to hear.
      duplicated.push(id);
      continue;
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
    seenIds.add(id);
    seenRanks.add(rank);
    out.push({
      id,
      rank,
      reason: typeof row.reason === "string" ? row.reason : "",
    });
  }
  const missing = [...expected].filter((id) => !seenIds.has(id));
  if (duplicated.length > 0 || missing.length > 0) {
    const twice =
      duplicated.length === 0
        ? ""
        : `ranking lists ${duplicated.map((id) => `"${id}"`).join(", ")} ${duplicated.length === 1 ? "twice" : "more than once"}`;
    const omitted =
      missing.length === 0 ? "" : `missing ids: ${missing.join(", ")}`;
    throw new Error(
      [twice, omitted].filter((part) => part !== "").join(" and "),
    );
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
  removeLegacyJudgeCaches(repoRoot);
  const open = store.ideas
    .filter((e) => e.status === "idea" || e.status === "proposed")
    .sort((a, b) => a.id.localeCompare(b.id));
  if (open.length === 0) {
    console.log(
      store.ideas.length === 0
        ? `backlog is empty — add ideas with \`video backlog add "<topic>"\``
        : `no open entries to judge — only idea/proposed entries are ranked (add or approve one first)`,
    );
    return 0;
  }

  const report = latestAnalyticsReport(repoRoot);
  // --json means stdout is machine-readable ONLY; evidence notices go to
  // stderr there (same convention as the ask protocol).
  const notice = (m: string): void =>
    opts.json === true ? console.error(m) : console.log(m);
  if (report === null) {
    notice(
      "  no analytics report in docs/analytics/ — ranking without viewing-data evidence (run `video analytics` to add it)",
    );
  } else {
    notice(`  viewing-data evidence: analytics report ${report.date}`);
  }
  // Already-produced stories: the judge cannot know 玄武门之变 was filmed
  // yesterday, so a reworded twin ranked #2 over fresher ideas (measured
  // 2026-11-19). The produced set rides in the prompt AND the fingerprint.
  const produced = store.ideas
    .filter((e) => e.status === "drafted")
    .map((e) => ({
      topic: e.topic,
      ...(e.project !== undefined ? { project: e.project } : {}),
    }))
    .sort(
      (a, b) =>
        a.topic.localeCompare(b.topic) ||
        (a.project ?? "").localeCompare(b.project ?? ""),
    );
  const cfg = loadProviderConfig();
  const route = judgeRoute(cfg, opts.model);
  const fingerprint = judgeFingerprint(repoRoot, store, route);
  // Legacy hash-named artifacts are cleaned up; all outcomes use one snapshot.
  const cachePath = judgeCachePath(repoRoot);

  let ranking: JudgeRank[] | null = null;
  let providerName = route.primary;
  let judgedAt = new Date().toISOString();

  // Same open set as last time → reuse. A corrupt cache is a miss with a
  // warning, never a crash: it gets overwritten by the fresh judgment.
  const cached = readJudgeCache(repoRoot);
  ranking = validCachedRanking(cached, fingerprint, expectedJudgeIds(store));
  if (ranking !== null && cached !== null) {
    console.log(
      `✓ judge cache hit — ${path.relative(repoRoot, cachePath)} (unchanged since ${cached.created})`,
    );
    providerName = cached.provider;
    judgedAt = cached.created;
  } else if (cached?.failure !== undefined) {
    console.error(`  previous judge failed: ${cached.failure.message}`);
  }

  if (ranking === null) {
    const messages = buildJudgeMessages(open, report ?? undefined, produced);
    let rawReply = "";
    // The retry is told WHAT was wrong. Re-sending the same prompt at a low
    // temperature only reproduced the mistake (2026-11-25: with the richer
    // evidence the model listed one entry twice, on both attempts).
    let complaint: string | undefined;
    // ONE automatic retry on an unusable reply; only the latest failure is
    // retained in the snapshot.
    for (let attempt = 1; attempt <= 2 && ranking === null; attempt++) {
      try {
        // Low temperature: a ranking should not shuffle between identical runs.
        const out = await chatWithFallback(
          providerInstance(route.primary),
          route.fallback !== undefined
            ? providerInstance(route.fallback)
            : null,
          {
            messages: retryTurns(messages, rawReply, complaint, open.length),
            temperature: 0.2,
          },
        );
        rawReply = out.response.content;
        providerName = out.provider;
        judgedAt = new Date().toISOString();
      } catch (err) {
        const message = `judge LLM call failed: ${(err as Error).message}`;
        writeJudgeCache(
          repoRoot,
          makeJudgeCacheRecord({
            fingerprint,
            provider: providerName,
            created: new Date().toISOString(),
            failure: { message },
          }),
        );
        console.error(`✗ ${message}`);
        return 1;
      }
      try {
        ranking = parseJudgeRanking(
          rawReply,
          open.map((e) => e.id),
        );
      } catch (err) {
        if (attempt === 2) {
          const message = `judge output unusable after retry: ${(err as Error).message}`;
          writeJudgeCache(
            repoRoot,
            makeJudgeCacheRecord({
              fingerprint,
              provider: providerName,
              created: new Date().toISOString(),
              failure: { message, raw_reply: rawReply },
            }),
          );
          console.error(`✗ ${message}`);
          return 1;
        }
        complaint = (err as Error).message;
        console.error(
          `  ! judge reply unusable (${complaint}) — retrying once`,
        );
      }
    }
    // Both attempts either parse or return — unreachable, but it gives TS
    // the narrowing the loop cannot express.
    if (ranking === null) return 1;

    let currentStore;
    try {
      currentStore = loadBacklogStore(repoRoot);
    } catch (err) {
      const message = `backlog changed while judging: ${(err as Error).message}`;
      writeJudgeCache(
        repoRoot,
        makeJudgeCacheRecord({
          fingerprint,
          provider: providerName,
          created: new Date().toISOString(),
          failure: { message },
        }),
      );
      console.error(`✗ ${message}`);
      return 1;
    }
    if (
      judgeFingerprint(
        repoRoot,
        currentStore,
        judgeRoute(loadProviderConfig(), opts.model),
      ) !== fingerprint
    ) {
      const message =
        "backlog or judge evidence changed while judging; run judge again";
      writeJudgeCache(
        repoRoot,
        makeJudgeCacheRecord({
          fingerprint,
          provider: providerName,
          created: new Date().toISOString(),
          failure: { message },
        }),
      );
      console.error(`✗ ${message}`);
      return 1;
    }
    writeJudgeCache(
      repoRoot,
      makeJudgeCacheRecord({
        fingerprint,
        provider: providerName,
        created: judgedAt,
        ranking,
      }),
    );
  }

  // Every refusal path above returned, so the loop only exits with a
  // parsed ranking — the guard stays because TS cannot follow the loop
  // invariant through the outer variable.
  if (ranking === null) return 1;

  const rankById = new Map(ranking.map((r) => [r.id, r]));
  // flatMap only guards a hand-edited cache file missing an id; the
  // parser has already enforced full coverage for fresh judgments.
  const rows = open
    .flatMap((e) => {
      const r = rankById.get(e.id);
      return r === undefined
        ? []
        : [
            {
              id: e.id,
              topic: e.topic,
              status: e.status,
              rank: r.rank,
              reason: r.reason,
            },
          ];
    })
    .sort((a, b) => a.rank - b.rank);

  if (opts.json === true) {
    console.log(
      JSON.stringify({
        schema: JUDGE_CACHE_SCHEMA,
        hash: fingerprint,
        provider: providerName,
        judged_at: judgedAt,
        ranking: rows,
      }),
    );
    return 0;
  }

  console.log(
    `✓ judge ranking of ${rows.length} open entries (${providerName}):`,
  );
  for (const row of rows) {
    const reason =
      row.reason.replace(/\s+/g, " ").trim() || "(no reason given)";
    console.log(`  ${row.rank}. ${row.id}  ${row.topic} — ${reason}`);
  }
  console.log(`  cache: ${path.relative(repoRoot, cachePath)}`);
  return 0;
}

export function addJudgeCommand(backlog: Command): void {
  backlog
    .command("judge")
    .description(
      "compare Gemini and OpenAI scores for open ideas in a weighted experiment",
    )
    .option("--json", "machine-readable output (full ranked object)")
    .option("--legacy", "use the previous analytics-based judge")
    .option(
      "--model <provider>",
      "legacy model provider: minimax|glm (implies --legacy)",
    )
    .option(
      "--cwd <dir>",
      "repo root (default: walk up to pnpm-workspace.yaml)",
    )
    .action(
      async (opts: {
        json?: boolean;
        legacy?: boolean;
        model?: string;
        cwd?: string;
      }) => {
        if (!opts.legacy && opts.model === undefined) {
          process.exitCode = await runBacklogJudgeExperiment(opts);
          return;
        }
        process.exitCode = await runBacklogJudge({
          ...(opts.json === true ? { json: true } : {}),
          ...(opts.model !== undefined
            ? { model: opts.model as "minimax" | "glm" }
            : {}),
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        });
      },
    );
}
