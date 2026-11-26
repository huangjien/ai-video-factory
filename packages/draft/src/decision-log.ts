/**
 * The decision log — one JSONL row per consult, appended per project.
 *
 * The rows tell each other apart by the `surface` field — `draft-bar`
 * rows come from the draft loop's reviewed attempts.
 *
 * The rows are a union, so the reader narrows by `surface` — the two
 * row types are imported as TYPES only, which keeps this module free of
 * a runtime cycle.
 */
import type { DraftDecisionRow } from "./draft-decision.js";

export type DecisionLogRow = DraftDecisionRow;

/** Read a decision log back. A truncated last line (a killed run) is
 *  skipped, not fatal. */
export function parseDecisionLog(body: string): DecisionLogRow[] {
  const rows: DecisionLogRow[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      rows.push(JSON.parse(trimmed) as DecisionLogRow);
    } catch {
      // A truncated line must not break the read.
    }
  }
  return rows;
}
