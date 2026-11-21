import {
  clampProbability,
  decisionInputToText,
  requestToBatch,
  validateDecisionBatch,
  type DecisionBatchRequest,
  type DecisionBatchResult,
  type DecisionInputModality,
  type DecisionAnswer,
  type DecisionError,
  type DecisionProvider,
  type DecisionRequest,
  type DecisionValue,
} from "./contract.js";

export interface OpenAIDecisionProviderOptions {
  /** API root. Default `https://api.openai.com/v1`. */
  baseUrl?: string | undefined;
  /** Model id. Default `gpt-6-luna` — the model that answers on the
   *  Decisions endpoint (`gpt-4o-mini` and the `gpt-5`/`gpt-6.1` lines
   *  are not available there). */
  model?: string | undefined;
  /** API key. Default: `OPENAI_API_KEY` from the environment. */
  apiKey?: string | undefined;
  /** Request timeout. Default 30 s. */
  timeoutMs?: number | undefined;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-6-luna";
const DEFAULT_TIMEOUT_MS = 30_000;

/** The Decisions API question payload for one of our questions. */
interface DecisionApiQuestion {
  name?: string;
  type: "predicate" | "choice" | "score";
  instructions: string;
  choices?: { value: string; description?: string }[];
  levels?: { label: string; description?: string }[];
}

/** One answer from the Decisions API. */
interface DecisionApiAnswer {
  type?: string;
  name?: string | null;
  choice?: string;
  score?: number;
  probability?: number;
  confidence?: number;
  probabilities?: {
    value?: string | number;
    label?: string;
    probability?: number;
  }[];
}

/**
 * OpenAI as a decision provider — through the **Decisions API**
 * (`POST /v1/decisions`), not through the chat API.
 *
 * The endpoint takes a state (`input`) plus typed questions, and answers
 * with a typed decision: a `choice` with a probability per option, a
 * `score` with a probability per rubric level, or a `predicate`
 * probability. The probabilities are the model's own, calibrated — the
 * chat API's logprobs trick is unnecessary here, and inferior: it
 * cannot express a rubric or a predicate at all.
 *
 * Measured 2026-11-14 against the live API (`gpt-6-luna`):
 *
 * - question types are `predicate`, `choice`, `score`; a `choice`
 *   question takes `choices: [{value, description?}]` and a `score`
 *   question takes `levels: [{label}]`.
 * - the answer carries `probabilities` per option/level plus a
 *   `confidence` that is NOT the top probability (0.72 vs 0.86 on the
 *   same answer) — the confidence is the model's own certainty, the
 *   probabilities are the distribution.
 * - a `score` answer's `score` is the probability-weighted average of
 *   the levels, so it lands between two levels (0.1 for a 90/10 split
 *   over levels 0 and 1).
 * - `output_tokens` is 0 — the decision costs input tokens only.
 */
export class OpenAIDecisionProvider implements DecisionProvider {
  readonly name = "openai";
  readonly supportedModalities: readonly DecisionInputModality[] = ["text"];
  lastError: Error | null = null;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(opts: OpenAIDecisionProviderOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = opts.model ?? DEFAULT_MODEL;
    this.apiKey = opts.apiKey ?? process.env["OPENAI_API_KEY"];
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  available(): boolean {
    return Boolean(this.apiKey);
  }

  async decide(req: DecisionRequest): Promise<DecisionAnswer | null> {
    const result = await this.decideMany(requestToBatch(req));
    const answer = result.answers[0]?.answer;
    return answer
      ? { ...answer, usage: result.usage, latencyMs: result.latencyMs }
      : null;
  }

  async decideMany(req: DecisionBatchRequest): Promise<DecisionBatchResult> {
    const started = Date.now();
    try {
      validateDecisionBatch(req);
      if (!this.apiKey) {
        throw new Error("OPENAI_API_KEY not set in environment");
      }
      const input = decisionInputToText(req.input);
      const res = await fetch(`${this.baseUrl}/decisions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input,
          questions: req.questions.map(({ question }) =>
            toApiQuestion(question),
          ),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        const excerpt = (await res.text()).slice(0, 200);
        const err = new Error(
          `OpenAI Decisions API ${res.status}: ${excerpt.slice(0, 80)}`,
        ) as DecisionError;
        err.provider = this.name;
        err.status = res.status;
        err.body_excerpt = excerpt;
        throw err;
      }
      const raw = await res.text();
      const parsed = JSON.parse(raw) as {
        model?: string;
        answers?: DecisionApiAnswer[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      this.lastError = null;
      const latencyMs = Date.now() - started;
      const model = parsed.model ?? this.model;
      const usage = {
        input: parsed.usage?.input_tokens ?? 0,
        output: parsed.usage?.output_tokens ?? 0,
      };
      const answers = req.questions.map(({ question, minConfidence }) => {
        const raw = parsed.answers?.find(
          (candidate) => candidate.name === question.id,
        );
        if (!raw)
          return {
            questionId: question.id,
            answer: null,
            error: "missing answer",
          };
        const value = toDecisionValue(question, raw);
        if (!value)
          return {
            questionId: question.id,
            answer: null,
            error: "invalid answer",
          };
        const confidence = clampProbability(
          raw.confidence ?? raw.probability ?? 0,
        );
        if (minConfidence !== undefined && confidence < minConfidence) {
          return {
            questionId: question.id,
            answer: null,
            error: "below minimum confidence",
          };
        }
        return {
          questionId: question.id,
          answer: {
            value,
            confidence,
            confidenceSource: "native" as const,
            usage: { input: 0, output: 0 },
            latencyMs,
            provider: this.name,
            model,
          },
          error: null,
        };
      });
      return { answers, provider: this.name, model, usage, latencyMs };
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      return {
        answers: req.questions.map(({ question }) => ({
          questionId: question.id,
          answer: null,
          error: this.lastError?.message ?? "request failed",
        })),
        provider: this.name,
        model: this.model,
        usage: { input: 0, output: 0 },
        latencyMs: Date.now() - started,
      };
    }
  }
}

/** Our question → the Decisions API question payload. */
function toApiQuestion(q: DecisionRequest["question"]): DecisionApiQuestion {
  if (q.kind === "choice") {
    const options = q.options ?? [];
    return {
      name: q.id,
      type: "choice",
      instructions: q.instructions,
      choices: options.map((option) => ({
        value: option,
        ...(q.optionHints?.[option]
          ? { description: q.optionHints[option] }
          : {}),
      })),
    };
  }
  if (q.kind === "score") {
    const levels = q.levels ?? [];
    return {
      name: q.id,
      type: "score",
      instructions: q.instructions,
      levels: levels.map((label) => ({ label })),
    };
  }
  // noul → a predicate: a statement that is true or false.
  const criteria = [
    q.trueMeaning ? `A true answer means: ${q.trueMeaning}` : "",
    q.falseMeaning ? `A false answer means: ${q.falseMeaning}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
  return {
    name: q.id,
    type: "predicate",
    instructions:
      criteria === "" ? q.instructions : `${q.instructions}\n${criteria}`,
  };
}

/** The API answer → our typed value. Null when the answer does not match
 *  the question it was asked. */
function toDecisionValue(
  question: DecisionRequest["question"],
  answer: DecisionApiAnswer,
): DecisionValue | null {
  const kind = question.kind;
  if (kind === "choice") {
    if (
      typeof answer.choice !== "string" ||
      !(question.options ?? []).includes(answer.choice)
    )
      return null;
    const probabilities: Record<string, number> = {};
    for (const p of answer.probabilities ?? []) {
      if (typeof p.value === "string" && typeof p.probability === "number") {
        probabilities[p.value] = clampProbability(p.probability);
      }
    }
    return {
      kind: "choice",
      option: answer.choice,
      ...(Object.keys(probabilities).length > 0 ? { probabilities } : {}),
    };
  }
  if (kind === "score") {
    if (
      typeof answer.score !== "number" ||
      answer.score < 0 ||
      answer.score > (question.levels?.length ?? 0) - 1
    )
      return null;
    const probabilities: Record<string, number> = {};
    const legend: Record<string, string> = {};
    for (const p of answer.probabilities ?? []) {
      if (typeof p.label !== "string" || typeof p.probability !== "number") {
        continue;
      }
      probabilities[p.label] = clampProbability(p.probability);
      legend[String(p.value ?? p.label)] = p.label;
    }
    return {
      kind: "score",
      score: answer.score,
      ...(Object.keys(probabilities).length > 0 ? { probabilities } : {}),
      legend,
    };
  }
  if (typeof answer.probability !== "number") return null;
  return { kind: "noul", probability: clampProbability(answer.probability) };
}
