import { mkdir, appendFile, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { LayaAnswer, LayaMode, LayaQuestion } from "./laya.js";

/**
 * v0.6 plan §4 — the per-project decision sidecar (`laya-decisions.jsonl`,
 * appended next to `article-review.yaml` in the project root). Every Laya
 * consultation lands here: it is the §7 shadow-evaluation corpus AND the
 * audit trail ("Git remembers" — although the file itself is run output
 * and stays untracked like runs/ and qa/).
 *
 * Shadow rows carry the answer the current (non-Laya) path produced in
 * `expected` plus the boolean `agreed`, so `video laya eval` can score
 * promotion gates without re-running anything.
 */

export interface LayaDecisionRecord {
  ts: string;
  /** Which integration surface produced the row: motion | visual | triage | cli. */
  surface: string;
  mode: LayaMode;
  state_sha256: string;
  questions: Record<string, LayaQuestion>;
  /** null = Laya produced no usable answer (down / timeout / all below
   * min_confidence) — the caller degraded to the default path. */
  answers: Record<string, LayaAnswer> | null;
  routing_model: string | null;
  latency_ms: number | null;
  /** Did the pipeline ACT on the decision (on-mode only; always false in
   * shadow — shadow never changes behavior). */
  acted: boolean;
  /** Shadow only: the answer today's path produced. */
  expected?: string;
  /** Shadow only: expected === laya's answer. */
  agreed?: boolean;
  note?: string;
}

export function stateSha256(state: string): string {
  return "sha256:" + createHash("sha256").update(state).digest("hex");
}

export async function appendLayaDecision(
  filePath: string,
  record: LayaDecisionRecord,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, JSON.stringify(record) + "\n", "utf8");
}

export async function readLayaDecisions(
  filePath: string,
): Promise<LayaDecisionRecord[]> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const rows: LayaDecisionRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      rows.push(JSON.parse(line) as LayaDecisionRecord);
    } catch {
      // A torn/corrupt line (crash mid-append) must not poison the corpus.
    }
  }
  return rows;
}

export interface SurfaceAgreement {
  surface: string;
  total: number;
  answered: number;
  agreed: number;
  agreementPct: number | null;
}

/** Aggregate shadow agreement for one surface over the corpus. */
export function summarizeAgreement(
  rows: LayaDecisionRecord[],
  surface: string,
): SurfaceAgreement {
  const mine = rows.filter((r) => r.surface === surface && r.mode === "shadow");
  const scored = mine.filter((r) => r.agreed !== undefined);
  const agreed = scored.filter((r) => r.agreed === true).length;
  return {
    surface,
    total: mine.length,
    answered: mine.filter((r) => r.answers !== null).length,
    agreed,
    agreementPct:
      scored.length === 0 ? null : Math.round((agreed / scored.length) * 100),
  };
}

/** Rewrite the whole corpus (tests use tmp files; callers should only
 * ever append). */
export async function writeLayaDecisions(
  filePath: string,
  rows: LayaDecisionRecord[],
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );
}
