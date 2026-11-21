import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import type { BacklogEntry, BacklogStore } from "./backlog-store.js";

export const JUDGE_CACHE_SCHEMA = "backlog-judge/2";
export const JUDGE_CACHE_FILENAME = "backlog-judge.yaml";
export const JUDGE_PROMPT_VERSION = "1";

export interface JudgeRank {
  id: string;
  rank: number;
  reason: string;
}

export interface JudgeFailure {
  message: string;
  raw_reply?: string;
}

export interface JudgeCacheRecord {
  schema: string;
  fingerprint: string;
  provider: string;
  created: string;
  ranking?: JudgeRank[];
  failure?: JudgeFailure;
}

export function judgeCachePath(repoRoot: string): string {
  return path.join(repoRoot, "runs", JUDGE_CACHE_FILENAME);
}

export function latestAnalyticsReport(
  repoRoot: string,
): { date: string; content: string } | null {
  const dir = path.join(repoRoot, "docs", "analytics");
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}-report\.md$/.test(name))
    .sort()
    .at(-1);
  if (file === undefined) return null;
  return {
    date: file.slice(0, 10),
    content: readFileSync(path.join(dir, file), "utf8"),
  };
}

export function judgeFingerprint(
  repoRoot: string,
  store: BacklogStore,
  route: { primary: string; fallback?: string },
): string {
  const open = store.ideas
    .filter((entry) => entry.status === "idea" || entry.status === "proposed")
    .map((entry) => ({
      id: entry.id,
      topic: entry.topic,
      note: entry.note?.trim().slice(0, 200) ?? "",
      anchors: entry.anchors ?? [],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const produced = store.ideas
    .filter((entry) => entry.status === "drafted")
    .map((entry) => ({ topic: entry.topic, project: entry.project ?? "" }))
    .sort((a, b) => a.topic.localeCompare(b.topic) || a.project.localeCompare(b.project));
  const report = latestAnalyticsReport(repoRoot);
  const input = {
    schema: JUDGE_CACHE_SCHEMA,
    promptVersion: JUDGE_PROMPT_VERSION,
    route,
    open,
    produced,
    report,
  };
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function validCachedRanking(
  record: JudgeCacheRecord | null,
  fingerprint: string,
  expectedIds: string[],
): JudgeRank[] | null {
  if (
    record === null ||
    record.schema !== JUDGE_CACHE_SCHEMA ||
    typeof record.fingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.fingerprint) ||
    record.fingerprint !== fingerprint ||
    typeof record.provider !== "string" ||
    typeof record.created !== "string" ||
    !Number.isFinite(Date.parse(record.created)) ||
    !Array.isArray(record.ranking) ||
    record.ranking.length !== expectedIds.length
  ) {
    return null;
  }
  if (new Set(expectedIds).size !== expectedIds.length) return null;
  const ids = new Set<string>();
  const ranks = new Set<number>();
  for (const row of record.ranking) {
    if (
      typeof row?.id !== "string" ||
      typeof row.rank !== "number" ||
      !Number.isInteger(row.rank) ||
      row.rank < 1 ||
      typeof row.reason !== "string" ||
      ids.has(row.id) ||
      ranks.has(row.rank)
    ) {
      return null;
    }
    ids.add(row.id);
    ranks.add(row.rank);
  }
  if (expectedIds.some((id) => !ids.has(id))) return null;
  if (ranks.size !== expectedIds.length) return null;
  for (let rank = 1; rank <= expectedIds.length; rank++) {
    if (!ranks.has(rank)) return null;
  }
  return [...record.ranking].sort((a, b) => a.rank - b.rank);
}

export function readJudgeCache(repoRoot: string): JudgeCacheRecord | null {
  const file = judgeCachePath(repoRoot);
  if (!existsSync(file)) return null;
  try {
    const parsed = parseYaml(readFileSync(file, "utf8")) as JudgeCacheRecord | null;
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeJudgeCache(repoRoot: string, record: JudgeCacheRecord): void {
  const target = judgeCachePath(repoRoot);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, yamlStringify(record) + "\n", "utf8");
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** Remove only artifacts produced by the previous hash-per-cache format. */
export function removeLegacyJudgeCaches(repoRoot: string): void {
  const dir = path.join(repoRoot, "runs");
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (/^backlog-judge-[0-9a-f]{64}(?:-failed)?\.yaml$/.test(file)) {
      unlinkSync(path.join(dir, file));
    }
  }
}

export function judgeRoute(
  config: { review: { primary: string; fallback?: string | undefined } },
  preferred?: string,
): { primary: string; fallback?: string } {
  const primary = preferred ?? config.review.primary;
  const fallback =
    primary === config.review.primary
      ? config.review.fallback
      : primary === config.review.fallback
        ? config.review.primary
        : undefined;
  return { primary, ...(fallback !== undefined ? { fallback } : {}) };
}

export function makeJudgeCacheRecord(args: {
  fingerprint: string;
  provider: string;
  created: string;
  ranking?: JudgeRank[];
  failure?: JudgeFailure;
}): JudgeCacheRecord {
  return {
    schema: JUDGE_CACHE_SCHEMA,
    fingerprint: args.fingerprint,
    provider: args.provider,
    created: args.created,
    ...(args.ranking !== undefined ? { ranking: args.ranking } : {}),
    ...(args.failure !== undefined ? { failure: args.failure } : {}),
  };
}

export function expectedJudgeIds(store: BacklogStore): string[] {
  return store.ideas
    .filter((entry: BacklogEntry) => entry.status === "idea" || entry.status === "proposed")
    .map((entry) => entry.id);
}
