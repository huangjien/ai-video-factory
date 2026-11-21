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

/** One shared input block. `data` stays binary in memory and is encoded by
 * the provider adapter only when its wire format requires base64. */
export type DecisionInputPart =
  | { type: "text"; text: string }
  | {
      type: "image" | "audio" | "video" | "document";
      mimeType: string;
      data: Uint8Array;
      name?: string | undefined;
    };

export interface DecisionBatchQuestion {
  question: DecisionQuestion;
  minConfidence?: number | undefined;
}

export interface DecisionBatchRequest {
  /** The same ordered context is evaluated for every question. */
  input: DecisionInputPart[];
  questions: DecisionBatchQuestion[];
}

export interface DecisionBatchAnswer {
  questionId: string;
  answer: DecisionAnswer | null;
  error: string | null;
}

export interface DecisionBatchResult {
  answers: DecisionBatchAnswer[];
  provider: string;
  model: string;
  usage: { input: number; output: number };
  latencyMs: number;
}

export type DecisionInputModality = DecisionInputPart["type"];

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
  /** Evaluate all questions against one shared input. */
  decideMany?(req: DecisionBatchRequest): Promise<DecisionBatchResult>;
  /** Input modalities accepted by this adapter. */
  readonly supportedModalities?: readonly DecisionInputModality[];
  /** False when the provider cannot run at all (no API key). The bench
   *  reports an unavailable provider instead of skipping it silently. */
  available(): boolean;
  /** The most recent failure, for diagnostics. Null after a success. */
  lastError: Error | null;
}

export function validateDecisionBatch(req: DecisionBatchRequest): void {
  if (req.input.length === 0) throw new Error("decision batch input is empty");
  if (req.questions.length === 0 || req.questions.length > 1000) {
    throw new Error("decision batch must have 1 to 1000 questions");
  }
  const ids = new Set<string>();
  for (const item of req.questions) {
    validateQuestion(item.question);
    if (
      item.minConfidence !== undefined &&
      (!Number.isFinite(item.minConfidence) ||
        item.minConfidence < 0 ||
        item.minConfidence > 1)
    ) {
      throw new Error(`invalid minimum confidence for ${item.question.id}`);
    }
    if (ids.has(item.question.id)) {
      throw new Error(`duplicate decision question id: ${item.question.id}`);
    }
    ids.add(item.question.id);
  }
  for (const part of req.input) {
    if (part.type === "text" && typeof part.text !== "string") {
      throw new Error("invalid text decision input");
    }
    if (
      part.type !== "text" &&
      part.type !== "image" &&
      part.type !== "audio" &&
      part.type !== "video" &&
      part.type !== "document"
    ) {
      throw new Error("unsupported decision input type");
    }
    if (part.type !== "text" && (!part.mimeType || !part.data?.byteLength)) {
      throw new Error(`invalid ${part.type} decision input`);
    }
  }
}

/** Convert legacy state to the new shared-input representation. */
export function requestToBatch(req: DecisionRequest): DecisionBatchRequest {
  return {
    input: [{ type: "text", text: stateToText(req.state) }],
    questions: [
      {
        question: req.question,
        ...(req.minConfidence !== undefined
          ? { minConfidence: req.minConfidence }
          : {}),
      },
    ],
  };
}

export function decisionInputToText(
  input: readonly DecisionInputPart[],
): string {
  if (input.some((part) => part.type !== "text")) {
    throw new Error("provider supports text input only");
  }
  return input
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

export function providerSupportsInput(
  provider: DecisionProvider,
  input: readonly DecisionInputPart[],
): boolean {
  const supported = provider.supportedModalities ?? ["text"];
  return input.every((part) => supported.includes(part.type));
}

/** Adapt legacy one-question providers to text-only batches. */
export async function decideManyWithProvider(
  provider: DecisionProvider,
  req: DecisionBatchRequest,
): Promise<DecisionBatchResult> {
  if (provider.decideMany) return provider.decideMany(req);
  const started = Date.now();
  const state = decisionInputToText(req.input);
  const answers: DecisionBatchResult["answers"] = [];
  let usage = { input: 0, output: 0 };
  let serviceError: Error | null = null;
  for (const [index, { question, minConfidence }] of req.questions.entries()) {
    const answer = await provider.decide({
      state,
      question,
      ...(minConfidence !== undefined ? { minConfidence } : {}),
    });
    if (answer) {
      usage = {
        input: usage.input + answer.usage.input,
        output: usage.output + answer.usage.output,
      };
    }
    if (!answer && provider.lastError) serviceError = provider.lastError;
    answers.push({
      questionId: question.id,
      answer: answer ? { ...answer, usage: { input: 0, output: 0 } } : null,
      error: answer
        ? null
        : (provider.lastError?.message ?? "no usable answer"),
    });
    if (!answer && provider.lastError) {
      for (const remaining of req.questions.slice(index + 1)) {
        answers.push({
          questionId: remaining.question.id,
          answer: null,
          error: provider.lastError.message,
        });
      }
      break;
    }
  }
  if (answers.every((item) => item.answer === null))
    provider.lastError = serviceError;
  return {
    answers,
    provider: provider.name,
    model: answers.find((item) => item.answer)?.answer?.model ?? "",
    usage,
    latencyMs: Date.now() - started,
  };
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
  if (typeof question.id !== "string" || !question.id.trim()) {
    throw new Error("decision question needs an id");
  }
  if (
    typeof question.instructions !== "string" ||
    !question.instructions.trim()
  ) {
    throw new Error(`decision question ${question.id} needs instructions`);
  }
  if (
    question.kind !== "choice" &&
    question.kind !== "score" &&
    question.kind !== "noul"
  ) {
    throw new Error(`decision question ${question.id} has an unknown kind`);
  }
  if (question.kind === "choice") {
    const options = question.options ?? [];
    if (
      options.length < 2 ||
      options.some((option) => typeof option !== "string" || !option.trim())
    ) {
      throw new Error(
        `decision question ${question.id} needs at least 2 options`,
      );
    }
  }
  if (question.kind === "score") {
    const levels = question.levels ?? [];
    if (
      levels.length < 2 ||
      levels.some((level) => typeof level !== "string" || !level.trim())
    ) {
      throw new Error(
        `decision question ${question.id} needs at least 2 levels`,
      );
    }
  }
}
