/**
 * The shared consult loop for decision surfaces.
 *
 * Two surfaces already consult the decision model (`qa-triage` in
 * `@video/qa`, `draft-bar` in `@video/draft`), and each grew its own
 * copy of the same four steps: build the question, call the provider,
 * normalize the answer into a log row, append the row. That is the
 * pattern this repo has already been bitten by — the nine sibling agents
 * each carried a private copy of the structured-agent loop until
 * `packages/llm/src/structured-agent.ts` collected it (see that file's
 * header: "The copies drifted").
 *
 * This module is that collection for the decision path. It is NOT a
 * replacement for the two existing seams — their row shapes, their
 * baselines and their harvest flows are theirs — but every NEW surface
 * uses this, so the sixth copy is never written.
 *
 * What it owns:
 *
 *  - the never-throw contract in one place (a provider that fails is a
 *    row with an error, never an exception that kills a render);
 *  - the answer normalization (a `choice` is an option, a `score` is a
 *    number, a `noul` is a probability);
 *  - the log write (JSONL, one row per consult, a write failure prints
 *    one line and never fails the run).
 */
import { appendFile } from "node:fs/promises";
import type {
  DecisionAnswer,
  DecisionProvider,
  DecisionQuestion,
  DecisionValue,
} from "./contract.js";

/** One consult's outcome, normalized for the log. */
export interface DecisionConsult {
  /** The answer as a flat string: the option name, the score, or the
   * probability. Null when the provider had no usable answer. */
  answer: string | null;
  /** The typed value, when the provider answered. */
  value: DecisionValue | null;
  confidence: number | null;
  confidenceSource: string | null;
  /** The provider that SERVED the call — a fallback chain answers with
   * the provider that actually ran, so a fallback run is visible in the
   * corpus instead of being averaged into the primary's score. */
  provider: string;
  model: string;
  usage: { input: number; output: number };
  latencyMs: number;
  /** Why there is no answer. Null when the provider answered. */
  error: string | null;
}

/** Ask one question. NEVER throws — a failure is a row with an error. */
export async function consultDecision(opts: {
  provider: DecisionProvider;
  question: DecisionQuestion;
  state: string | Record<string, unknown> | unknown[];
  /** Below this confidence the answer is treated as no answer. */
  minConfidence?: number | undefined;
}): Promise<DecisionConsult> {
  const started = Date.now();
  let answer: DecisionAnswer | null = null;
  let error: string | null = null;
  try {
    answer = await opts.provider.decide({
      state: opts.state,
      question: opts.question,
      ...(opts.minConfidence !== undefined
        ? { minConfidence: opts.minConfidence }
        : {}),
    });
  } catch (err) {
    error = (err as Error).message;
  }
  if (answer === null) {
    return {
      answer: null,
      value: null,
      confidence: null,
      confidenceSource: null,
      provider: opts.provider.name,
      model: "",
      usage: { input: 0, output: 0 },
      latencyMs: Date.now() - started,
      error: error ?? opts.provider.lastError?.message ?? "no answer",
    };
  }
  return {
    answer: valueToString(answer.value),
    value: answer.value,
    confidence: answer.confidence,
    confidenceSource: answer.confidenceSource,
    provider: answer.provider,
    model: answer.model,
    usage: answer.usage,
    latencyMs: answer.latencyMs,
    error,
  };
}

/** The flat string form of a typed value — what the log row carries. */
export function valueToString(value: DecisionValue): string {
  if (value.kind === "choice") return value.option;
  if (value.kind === "score") return String(value.score);
  return String(value.probability);
}

/** Append rows to a project's decision log. One JSON object per line.
 *
 * A write failure prints ONE line and never fails the run: the decision
 * layer is advisory, and a log that cannot be written must not stop a
 * render. */
export async function appendDecisionRows(
  logPath: string,
  rows: readonly unknown[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const body = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
    await appendFile(logPath, body, "utf8");
  } catch (err) {
    console.error(
      `  ! could not write the decision log (${logPath}): ${(err as Error).message}`,
    );
  }
}
