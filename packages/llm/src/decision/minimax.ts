import {
  clampProbability,
  validateDecisionBatch,
  type DecisionAnswer,
  type DecisionBatchRequest,
  type DecisionBatchResult,
  type DecisionError,
  type DecisionInputModality,
  type DecisionProvider,
  type DecisionRequest,
  type DecisionValue,
} from "./contract.js";
import { stateToText } from "./contract.js";
import { deriveValueFromDistribution } from "./derive.js";
import { extractJsonObject } from "../structured-agent.js";
import { defaultModel } from "../config.js";

export interface MiniMaxDecisionProviderOptions {
  /** API host. Default `https://api.minimax.io`. */
  apiHost?: string | undefined;
  /** Model id. Default `models.decision.minimax` in `config/llm.yaml`. */
  model?: string | undefined;
  /** API key. Default: `MINIMAX_API_KEY` from the environment. */
  apiKey?: string | undefined;
  /** Request timeout. Default 60 s — MiniMax reasons before it calls the
   *  function, and that reasoning is slow. */
  timeoutMs?: number | undefined;
  /** Output budget. Default 2048 — the model spends hundreds of tokens
   *  reasoning before it emits the tool call; a smaller budget truncates
   *  the call away entirely (measured: 512 tokens → `finish_reason:
   *  length`, no tool call at all). */
  maxTokens?: number | undefined;
  /** 1 = one call, the model's self-reported confidence.
   *  >1 = sample the question that many times and read the vote
   *  distribution — a real frequency, at the cost of k calls. */
  samples?: number | undefined;
  /** Temperature used when sampling more than once. Default 1. */
  voteTemperature?: number | undefined;
}

const DEFAULT_API_HOST = "https://api.minimax.io";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 2048;

/** The function-call schema for one decision question.
 *
 * The model answers by CALLING the function, with the answer in the
 * arguments — the same shape OpenAI-compatible APIs use for tools:
 *
 * ```json
 * {
 *   "name": "classify_incident",
 *   "description": "Classify a DevOps incident",
 *   "parameters": {
 *     "type": "object",
 *     "properties": {
 *       "category": { "type": "string", "enum": ["infrastructure", "…"] },
 *       "confidence": { "type": "number" },
 *       "reason": { "type": "string" }
 *     },
 *     "required": ["category", "confidence", "reason"]
 *   }
 * }
 * ```
 *
 * The `enum` is the question's own option list, so the model cannot
 * invent an answer outside it — the schema is the type system, and the
 * enum does the bounding that a validator would otherwise have to. */
export interface DecisionFunctionSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

/** A JSON-schema-ish function name: letters, digits, underscore. */
export function functionNameFor(questionId: string): string {
  const cleaned = questionId.replace(/[^a-zA-Z0-9_]/g, "_");
  const name = cleaned.length > 0 ? cleaned : "decide";
  return /^[a-zA-Z_]/.test(name) ? name : `decide_${name}`;
}

/** The property that carries the answer. A domain-specific name grounds
 *  the model better than a generic one, so the question may set it. */
function resultPropertyFor(
  kind: DecisionRequest["question"]["kind"],
  requested: string | undefined,
): string {
  if (requested && requested.trim() !== "") return requested.trim();
  if (kind === "choice") return "choice";
  if (kind === "score") return "severity";
  return "verdict";
}

/** Build the function schema for a decision question. */
export function buildDecisionFunction(
  req: DecisionRequest,
): DecisionFunctionSchema {
  const q = req.question;
  const property = resultPropertyFor(q.kind, q.resultProperty);
  const description = q.instructions;
  if (q.kind === "noul") {
    return {
      name: functionNameFor(q.id),
      description,
      parameters: {
        type: "object",
        properties: {
          [property]: {
            type: "boolean",
            description: "true when the statement holds for the state.",
          },
          probability: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "How likely the statement is to hold, 0 to 1.",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "How sure you are, 0 to 1.",
          },
          reason: {
            type: "string",
            description: "One sentence: why you decided this.",
          },
        },
        required: [property, "probability", "confidence", "reason"],
      },
    };
  }
  const values = q.kind === "choice" ? (q.options ?? []) : (q.levels ?? []);
  const hints = q.optionHints ?? {};
  return {
    name: functionNameFor(q.id),
    description,
    parameters: {
      type: "object",
      properties: {
        [property]: {
          type: "string",
          enum: values,
          ...(Object.keys(hints).length > 0
            ? {
                description: Object.entries(hints)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("; "),
              }
            : {}),
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "How sure you are, 0 to 1.",
        },
        reason: {
          type: "string",
          description: "One sentence: why you decided this.",
        },
      },
      required: [property, "confidence", "reason"],
    },
  };
}

/** The state and the question as the model sees them. The option list
 *  travels in the schema's enum, so the prompt does not repeat it. */
function buildUserContent(req: DecisionRequest): string {
  const q = req.question;
  const lines = [`State:`, stateToText(req.state), "", q.instructions];
  if (q.kind === "noul") {
    if (q.trueMeaning) lines.push(`A true answer means: ${q.trueMeaning}`);
    if (q.falseMeaning) lines.push(`A false answer means: ${q.falseMeaning}`);
  }
  return lines.join("\n");
}

/**
 * MiniMax as a decision provider — through **function calling**.
 *
 * The question becomes a function whose parameters carry the answer: the
 * option list is the `enum`, the model returns the chosen value, a
 * `confidence`, and a one-sentence `reason`. The tool call is forced
 * (`tool_choice`), so the answer cannot arrive as prose.
 *
 * Measured 2026-11-14 against the live API (`MiniMax-M3.1-Flash`):
 *
 * - the tool call works and comes back as
 *   `choices[0].message.tool_calls[0].function.arguments` (a JSON string).
 * - **the model reasons first, and it reasons a lot**: a one-line
 *   question cost 491 prompt tokens, 427 reasoning tokens and 598
 *   completion tokens.
 * - **the output budget must cover the reasoning**: at `max_tokens: 512`
 *   the call ended with `finish_reason: length` and NO tool call at all.
 *   The default here is 2048 for that reason.
 */
export class MiniMaxDecisionProvider implements DecisionProvider {
  readonly name = "minimax";
  readonly supportedModalities: readonly DecisionInputModality[] = ["text"];
  lastError: Error | null = null;

  private readonly apiHost: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly samples: number;
  private readonly voteTemperature: number;

  constructor(opts: MiniMaxDecisionProviderOptions = {}) {
    this.apiHost = (opts.apiHost ?? DEFAULT_API_HOST).replace(/\/+$/, "");
    this.model = opts.model ?? defaultModel("decision", "minimax");
    this.apiKey = opts.apiKey ?? process.env["MINIMAX_API_KEY"];
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.samples = Math.max(1, opts.samples ?? 1);
    this.voteTemperature = opts.voteTemperature ?? 1;
  }

  available(): boolean {
    return Boolean(this.apiKey);
  }

  async decideMany(req: DecisionBatchRequest): Promise<DecisionBatchResult> {
    const started = Date.now();
    const answers: DecisionBatchResult["answers"] = [];
    let usage = { input: 0, output: 0 };
    let serviceError: Error | null = null;
    try {
      validateDecisionBatch(req);
      if (req.input.some((part) => part.type !== "text")) {
        throw new Error("MiniMax supports text input only");
      }
      if (!this.apiKey)
        throw new Error("MINIMAX_API_KEY not set in environment");
      const state = req.input
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n");
      for (const [
        index,
        { question, minConfidence },
      ] of req.questions.entries()) {
        const answer = await this.decide({
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
        if (!answer && this.lastError) serviceError = this.lastError;
        answers.push({
          questionId: question.id,
          answer: answer ? { ...answer, usage: { input: 0, output: 0 } } : null,
          error: answer
            ? null
            : (this.lastError?.message ?? "no usable answer"),
        });
        if (!answer && this.lastError) {
          for (const remaining of req.questions.slice(index + 1)) {
            answers.push({
              questionId: remaining.question.id,
              answer: null,
              error: this.lastError.message,
            });
          }
          break;
        }
      }
      if (answers.every((item) => item.answer === null)) {
        this.lastError = serviceError;
      }
      return {
        answers,
        provider: this.name,
        model: this.model,
        usage,
        latencyMs: Date.now() - started,
      };
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
        usage,
        latencyMs: Date.now() - started,
      };
    }
  }

  async decide(req: DecisionRequest): Promise<DecisionAnswer | null> {
    const started = Date.now();
    this.lastError = null;
    try {
      if (!this.apiKey) {
        throw new Error("MINIMAX_API_KEY not set in environment");
      }
      const schema = buildDecisionFunction(req);
      const property = resultPropertyFor(
        req.question.kind,
        req.question.resultProperty,
      );
      const temperature = this.samples > 1 ? this.voteTemperature : 0;

      const calls = await Promise.allSettled(
        Array.from({ length: this.samples }, () =>
          this.callOnce(schema, buildUserContent(req), temperature, property),
        ),
      );
      const answers = calls
        .filter((c) => c.status === "fulfilled")
        .map((c) => c.value);
      if (answers.length === 0) {
        const first = calls.find(
          (c): c is PromiseRejectedResult => c.status === "rejected",
        );
        throw new Error(
          `MiniMax returned no usable tool call (${this.samples} samples failed)${
            first?.reason instanceof Error ? `: ${first.reason.message}` : ""
          }`,
        );
      }
      const usage = answers.reduce(
        (acc, c) => ({
          input: acc.input + c.usage.input,
          output: acc.output + c.usage.output,
        }),
        { input: 0, output: 0 },
      );

      if (this.samples > 1) {
        const counts: Record<string, number> = {};
        for (const call of answers) {
          if (call.value === null) continue;
          counts[call.value] = (counts[call.value] ?? 0) + 1;
        }
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        if (total === 0) {
          throw new Error("MiniMax returned no usable answer in any sample");
        }
        const distribution: Record<string, number> = {};
        for (const [value, count] of Object.entries(counts)) {
          distribution[value] = count / total;
        }
        const value = deriveValueFromDistribution(req.question, distribution);
        if (!value) return null;
        const top = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0];
        const confidence = clampProbability(top?.[1] ?? 0);
        if (req.minConfidence !== undefined && confidence < req.minConfidence) {
          return null;
        }
        return {
          value,
          confidence,
          confidenceSource: "vote",
          ...(answers[0]?.reason ? { reason: answers[0].reason } : {}),
          usage,
          latencyMs: Date.now() - started,
          provider: this.name,
          model: this.model,
        };
      }

      const call = answers[0];
      if (!call || call.value === null) {
        throw new Error("MiniMax tool call carried no usable answer");
      }
      const confidence = clampProbability(call.confidence);
      // One answer is a one-hot distribution. A `noul` carries the
      // model's own probability instead, which the schema asks for.
      const distribution =
        req.question.kind === "noul"
          ? {
              true: call.probability,
              false: 1 - call.probability,
            }
          : { [call.value]: 1 };
      const value = deriveValueFromDistribution(req.question, distribution);
      if (!value) return null;
      if (req.minConfidence !== undefined && confidence < req.minConfidence) {
        return null;
      }
      return {
        value,
        confidence,
        confidenceSource: "self_reported",
        ...(call.reason ? { reason: call.reason } : {}),
        usage,
        latencyMs: Date.now() - started,
        provider: this.name,
        model: this.model,
      };
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      return null;
    }
  }

  /** One chat call with the decision function forced. */
  private async callOnce(
    schema: DecisionFunctionSchema,
    user: string,
    temperature: number,
    property: string,
  ): Promise<{
    value: string | null;
    confidence: number;
    probability: number;
    reason: string | undefined;
    usage: { input: number; output: number };
  }> {
    const res = await fetch(`${this.apiHost}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: user }],
        tools: [
          {
            type: "function",
            function: {
              name: schema.name,
              description: schema.description,
              parameters: schema.parameters,
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: schema.name },
        },
        max_tokens: this.maxTokens,
        temperature,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const excerpt = (await res.text()).slice(0, 200);
      const err = new Error(
        `MiniMax API ${res.status}: ${excerpt.slice(0, 80)}`,
      ) as DecisionError;
      err.provider = this.name;
      err.status = res.status;
      err.body_excerpt = excerpt;
      throw err;
    }
    const raw = await res.text();
    const parsed = JSON.parse(raw) as {
      choices?: {
        message?: {
          content?: string;
          tool_calls?: {
            function?: { name?: string; arguments?: string };
          }[];
        };
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const toolCall = parsed.choices?.[0]?.message?.tool_calls?.[0];
    let args = toolCall?.function?.arguments;
    if (!args) {
      // The model answered in prose instead of calling the function —
      // it reasons first, and sometimes the answer comes out as text
      // even with a forced tool_choice. Recover the same JSON object
      // from the content rather than throwing the answer away.
      const content = parsed.choices?.[0]?.message?.content ?? "";
      const json = extractJsonObject(content);
      if (json) args = json;
    }
    if (!args) {
      throw new Error("MiniMax answer carried no tool call");
    }
    let decoded: {
      [key: string]: unknown;
    };
    try {
      decoded = JSON.parse(args) as { [key: string]: unknown };
    } catch {
      throw new Error("MiniMax tool call arguments were not JSON");
    }
    const rawValue = decoded[property];
    const value =
      typeof rawValue === "string"
        ? rawValue
        : typeof rawValue === "boolean"
          ? String(rawValue)
          : null;
    return {
      value,
      confidence:
        typeof decoded["confidence"] === "number"
          ? clampProbability(decoded["confidence"])
          : 0,
      probability:
        typeof decoded["probability"] === "number"
          ? clampProbability(decoded["probability"])
          : 0,
      reason:
        typeof decoded["reason"] === "string" ? decoded["reason"] : undefined,
      usage: {
        input: parsed.usage?.prompt_tokens ?? 0,
        output: parsed.usage?.completion_tokens ?? 0,
      },
    };
  }
}
