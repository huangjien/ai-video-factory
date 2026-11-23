import {
  clampProbability,
  validateDecisionBatch,
  requestToBatch,
  type DecisionBatchRequest,
  type DecisionBatchResult,
  type DecisionInputPart,
  type DecisionInputModality,
  type DecisionAnswer,
  type DecisionError,
  type DecisionProvider,
  type DecisionRequest,
  type DecisionValue,
} from "./contract.js";
import { defaultModel } from "../config.js";

export interface GoogleDecisionProviderOptions {
  /** API root. Default `https://generativelanguage.googleapis.com/v1beta`. */
  baseUrl?: string | undefined;
  /** Model id. Default `models.decision.google` in `config/llm.yaml`. */
  model?: string | undefined;
  /** API key. Default: `GEMINI_API_KEY` from the environment. */
  apiKey?: string | undefined;
  /** Request timeout. Default 30 s. */
  timeoutMs?: number | undefined;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TIMEOUT_MS = 30_000;

interface GoogleDecisionQuestion {
  type: "noul" | "choice" | "score";
  instructions: string;
  criteria?: Record<string, string> | string[];
}

interface GoogleDecisionAnswer {
  type?: string;
  choice?: string;
  noul?: number;
  score?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, string>;
}

/** Google Gemini Decisions API (`POST /v1beta/decisions`). */
export class GoogleDecisionProvider implements DecisionProvider {
  readonly name = "google";
  readonly supportedModalities: readonly DecisionInputModality[] = [
    "text",
    "image",
    "audio",
    "video",
    "document",
  ];
  lastError: Error | null = null;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(opts: GoogleDecisionProviderOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = opts.model ?? defaultModel("decision", "google");
    this.apiKey = opts.apiKey ?? process.env["GEMINI_API_KEY"];
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
      if (!this.apiKey)
        throw new Error("GEMINI_API_KEY not set in environment");
      const unsupported = req.input.find(
        (part) => !this.supportedModalities.includes(part.type),
      );
      if (unsupported)
        throw new Error(`Google does not support ${unsupported.type} input`);
      const res = await fetch(`${this.baseUrl}/decisions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          model: this.model,
          input: req.input.map(toGoogleInput),
          questions: Object.fromEntries(
            req.questions.map(({ question }) => [
              question.id,
              toGoogleQuestion(question),
            ]),
          ),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        const err = new Error(
          `Google Decisions API ${res.status}`,
        ) as DecisionError;
        err.provider = this.name;
        err.status = res.status;
        throw err;
      }
      const parsed = (await res.json()) as {
        model?: string;
        answers?: Record<string, GoogleDecisionAnswer>;
        usage?: { total_input_tokens?: number; total_output_tokens?: number };
      };
      this.lastError = null;
      const latencyMs = Date.now() - started;
      const model = parsed.model ?? this.model;
      const usage = {
        input: parsed.usage?.total_input_tokens ?? 0,
        output: parsed.usage?.total_output_tokens ?? 0,
      };
      const answers = req.questions.map(({ question, minConfidence }) => {
        const raw = parsed.answers?.[question.id];
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
          raw.confidence ?? (value.kind === "noul" ? value.probability : 0),
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

function toGoogleInput(part: DecisionInputPart): unknown {
  if (part.type === "text") return { type: "text", text: part.text };
  return {
    type: part.type,
    data: Buffer.from(part.data).toString("base64"),
    mime_type: part.mimeType,
  };
}

function toGoogleQuestion(
  q: DecisionRequest["question"],
): GoogleDecisionQuestion {
  if (q.kind === "choice") {
    return {
      type: "choice",
      instructions: q.instructions,
      criteria: Object.fromEntries(
        (q.options ?? []).map((option) => [
          option,
          q.optionHints?.[option] ?? "",
        ]),
      ),
    };
  }
  if (q.kind === "score") {
    return {
      type: "score",
      instructions: q.instructions,
      criteria: q.levels ?? [],
    };
  }
  const criteria: Record<string, string> = {};
  if (q.trueMeaning) criteria["true_description"] = q.trueMeaning;
  if (q.falseMeaning) criteria["false_description"] = q.falseMeaning;
  return {
    type: "noul",
    instructions: q.instructions,
    ...(Object.keys(criteria).length > 0 ? { criteria } : {}),
  };
}

function toDecisionValue(
  question: DecisionRequest["question"],
  answer: GoogleDecisionAnswer,
): DecisionValue | null {
  if (question.kind === "choice") {
    if (
      typeof answer.choice !== "string" ||
      !(question.options ?? []).includes(answer.choice)
    ) {
      return null;
    }
    return {
      kind: "choice",
      option: answer.choice,
      ...(answer.probabilities
        ? { probabilities: clampMap(answer.probabilities) }
        : {}),
    };
  }
  if (question.kind === "score") {
    const levels = question.levels ?? [];
    if (
      typeof answer.score !== "number" ||
      !Number.isFinite(answer.score) ||
      answer.score < 0 ||
      answer.score > levels.length - 1
    ) {
      return null;
    }
    return {
      kind: "score",
      score: answer.score,
      ...(answer.probabilities
        ? { probabilities: clampMap(answer.probabilities) }
        : {}),
      legend:
        answer.legend ??
        Object.fromEntries(levels.map((level, i) => [String(i), level])),
    };
  }
  if (typeof answer.noul !== "number") return null;
  return { kind: "noul", probability: clampProbability(answer.noul) };
}

function clampMap(values: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      clampProbability(value),
    ]),
  );
}
