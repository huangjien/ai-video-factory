/**
 * The decision contract.
 *
 * A decision is a TYPED answer — `choice`, `score`, `noul` — with a
 * confidence attached, not a paragraph of prose. The pipeline has a lot of
 * questions that need exactly one of those ("which visual component fits
 * this scene?", "does this QA finding block the render?"), and today each
 * one is answered by a regex, a heuristic, or a full chat generation.
 *
 * The shape is deliberately independent of any provider: the same question
 * must be answerable by a logprob-scored chat model, by a chat model that
 * can only report its own confidence, or by a rule, and the comparison
 * between them has to be apples-to-apples.
 *
 * Three invariants every provider keeps:
 *
 *  1. **Never throws.** `decide()` returns `null` when the provider is
 *     down, times out, answers outside the allowed options, or answers
 *     below `minConfidence`. A decision layer that can fail a render is
 *     worse than no decision layer.
 *  2. **Bounded.** An answer outside the question's criteria is `null`,
 *     never a best-effort guess.
 *  3. **Degrade to current behavior.** `null` means the caller runs
 *     exactly the code path it runs today.
 */

export type DecisionKind = "choice" | "score" | "noul";

export interface DecisionQuestion {
  /** Stable id — the key the answer is recorded under. */
  id: string;
  kind: DecisionKind;
  /** What to decide. ONE wording for every provider: the comparison is
   *  only fair if the providers are asked the same thing. */
  instructions: string;
  /** `choice`: the allowed option names, in the order they are offered. */
  options?: string[] | undefined;
  /** `choice`: what each option means. Optional, but it is the cheapest
   *  accuracy lever there is. */
  optionHints?: Record<string, string> | undefined;
  /** `score`: the ordered level descriptions. The level's position is the
   *  score, so level 0 is the lowest. */
  levels?: string[] | undefined;
  /** `noul`: what a yes/true means. Optional. */
  trueMeaning?: string | undefined;
  /** `noul`: what a no/false means. Optional. */
  falseMeaning?: string | undefined;
  /** The name of the property that carries the answer in a function-call
   *  schema (`"category"`, `"verdict"`, …). Optional — a domain-specific
   *  name grounds the model better than a generic one. */
  resultProperty?: string | undefined;
}

export interface DecisionRequest {
  /** The state the decision is about. A string, an object, or an array —
   *  a structured state beats a serialized blob. */
  state: string | Record<string, unknown> | unknown[];
  question: DecisionQuestion;
  /** Below this confidence the answer is treated as no answer. */
  minConfidence?: number | undefined;
}

export type DecisionValue =
  | {
      kind: "choice";
      option: string;
      /** The distribution over the options. Absent when the provider can
       *  only name a winner (a self-reported confidence has no peers). */
      probabilities?: Record<string, number> | undefined;
    }
  | {
      kind: "score";
      /** The score. May fall between two levels when the answer carries a
       *  distribution (probability-weighted average). */
      score: number;
      probabilities?: Record<string, number> | undefined;
      /** level index → level text, so the score is readable on its own. */
      legend: Record<string, string>;
    }
  | {
      kind: "noul";
      /** The probability that the statement is true, 0..1. Not a boolean:
       *  0.5 means the model does not know. */
      probability: number;
    };

/** Where the confidence came from — and therefore how much it is worth.
 *
 *  - `logprobs`: derived from the model's token probabilities. Closest to
 *    a calibrated probability.
 *  - `self_reported`: the model was asked how sure it is. Cheap, and
 *    close to noise — treat it as a ranking hint, not a probability.
 *  - `vote`: the share of sampled answers that agreed. A real frequency,
 *    at the cost of k calls. */
export type ConfidenceSource =
  /** The provider's own calibrated probability (OpenAI's Decisions API). */
  | "native"
  /** The model was asked how sure it is. */
  | "self_reported"
  /** The share of sampled answers that agreed. */
  | "vote";

export interface DecisionAnswer {
  value: DecisionValue;
  /** 0..1. For `noul` this is the probability itself. */
  confidence: number;
  confidenceSource: ConfidenceSource;
  /** The model's own sentence for the answer, when it gave one. Kept for
   *  the decision log — it is what a human reads when a decision is
   *  wrong. */
  reason?: string | undefined;
  usage: { input: number; output: number };
  latencyMs: number;
  provider: string;
  model: string;
}

export interface DecisionProvider {
  readonly name: string;
  /** NEVER throws — see invariant 1 above. Returns `null` for "no usable
   *  answer". The last failure is kept on `lastError` for diagnosis. */
  decide(req: DecisionRequest): Promise<DecisionAnswer | null>;
  /** False when the provider cannot run at all (no API key). The bench
   *  reports an unavailable provider instead of skipping it silently. */
  available(): boolean;
  /** The most recent failure, for diagnostics. Null after a success. */
  lastError: Error | null;
}

/** A failure raised while deciding. Mirrors `ChatError` in `provider.ts`. */
export interface DecisionError extends Error {
  provider: string;
  status?: number | undefined;
  body_excerpt?: string | undefined;
}

/** The state as text. A string passes through; an object or array is
 *  rendered as JSON — a named structure beats a serialized blob the
 *  model has to re-parse. */
export function stateToText(state: DecisionRequest["state"]): string {
  if (typeof state === "string") return state;
  return JSON.stringify(state, null, 2);
}

/** Clamp a number into 0..1. A non-finite value is 0 — a broken number
 *  must never become a probability. */
export function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Reject a malformed question before any provider spends a token.
 *  Throws — a bad question is a programming error, not a runtime
 *  condition. */
export function validateQuestion(question: DecisionQuestion): void {
  if (!question.id) throw new Error("decision question needs an id");
  if (!question.instructions.trim()) {
    throw new Error(`decision question ${question.id} needs instructions`);
  }
  if (question.kind === "choice") {
    const options = question.options ?? [];
    if (options.length < 2) {
      throw new Error(
        `decision question ${question.id} needs at least 2 options`,
      );
    }
  }
  if (question.kind === "score") {
    const levels = question.levels ?? [];
    if (levels.length < 2) {
      throw new Error(
        `decision question ${question.id} needs at least 2 levels`,
      );
    }
  }
}
