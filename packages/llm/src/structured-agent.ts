import { parse as parseYaml } from "yaml";
import type { ChatMessage, Provider } from "./provider.js";
import { chatWithFallback } from "./retry.js";
import { stripReasoning } from "./stream.js";

/**
 * The structured-agent runtime — the one call loop every LLM agent shares:
 * chat (with retry/fallback) → extract the answer → parse → validate, and
 * optionally one repair pass when the answer is unusable.
 *
 * Before this module, nine sibling agents each carried a private copy of
 * that loop. The copies drifted: the reasoning-strip fix (a model's
 * `<think>` sketch mistaken for the answer) landed in @video/youtube and
 * @video/draft but not in script/review/research/storyboard/motion, where
 * the same bug lived on. Extraction now ALWAYS strips reasoning first, and
 * the loop itself lives here once.
 *
 * What stays per-agent: the prompt (`packages/prompts`), the schema, the
 * error class (each package's public interface), and the POLICY for what
 * to do when the model misbehaves — a repair pass, a re-ask on another
 * provider, or a degraded result instead of a failure.
 */

/** Structural stand-in for a zod schema — the runtime validates with zod
 *  semantics without @video/llm depending on zod. */
export interface SafeParseSchema<T> {
  safeParse(input: unknown): SafeParseResult<T>;
}

export type SafeParseResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { issues: { path: PropertyKey[]; message: string }[] };
    };

export interface StructuredAgentResult<T> {
  data: T;
  usage: { input: number; output: number };
  /** Name of the provider that actually served the request
   * (primary or its fallback, per `chatWithFallback`). */
  providerName: string;
  /** The exact messages sent to the provider — lets callers hash the
   * real prompt for run-record `prompt_hash`. */
  messages: ChatMessage[];
}

/**
 * Read one reply into the answer. Throw to signal "this reply is unusable"
 * — the runtime then either asks again (when `nextAttempt` says how) or
 * reports the failure.
 */
export type StructuredParser<T> = (content: string, providerName: string) => T;

/** What to send for the next attempt after an unusable reply. */
export interface StructuredNextAttempt {
  /** The messages to send. */
  messages: ChatMessage[];
  /** The provider to ask. When given, the runtime asks THIS provider and
   *  owns its failover — an agent that names a provider owns what happens
   *  when that provider is down too. */
  provider?: Provider;
}

export interface StructuredCallOptions<T> {
  /** The prompt. The result's `messages` are always these — never the
   *  repair scaffolding, so `prompt_hash` describes the prompt and not the
   *  conversation that produced it. */
  messages: ChatMessage[];
  provider: Provider;
  fallback?: Provider | null;
  /** How to read one reply into the answer. */
  parse: StructuredParser<T>;
  /** Total attempts, including the first. Default 1. */
  attempts?: number | undefined;
  /** What to do when the provider answered but the answer is unusable.
   *
   *  A provider ERROR never reaches here — it propagates straight out, so
   *  "the model was wrong" and "the provider was down" stay distinct. */
  nextAttempt?:
    | ((
        error: Error,
        attempt: number,
        servedBy: string,
      ) => StructuredNextAttempt | null)
    | undefined;
  /** Report the final failure. Default: throw the last parse error.
   *
   *  Receives EVERY error, in order: the first is the original failure,
   *  the last is the one that ended the run. */
  onFailure?:
    | ((errors: Error[], providerName: string, attempts: number) => Error)
    | undefined;
  /** Extra ChatRequest fields (model / temperature / response_format). */
  request?: {
    model?: string;
    temperature?: number;
    response_format?: { type: "json_object" | "text" };
  };
}

export interface StructuredCallResult<T> {
  data: T;
  usage: { input: number; output: number };
  providerName: string;
  /** The messages the call started from. */
  messages: ChatMessage[];
  /** How many provider calls it took. 1 = the first reply was usable. */
  attempts: number;
}

/**
 * The shared call loop: chat (with retry and provider fallback), read the
 * answer, and — when the agent supplied a way to ask again — try once more
 * before giving up.
 *
 * Usage is accumulated across attempts, and the returned `messages` are
 * always the ORIGINAL prompt, so a repair pass never changes what a
 * run-record's `prompt_hash` describes.
 */
export async function callStructured<T>(
  opts: StructuredCallOptions<T>,
): Promise<StructuredCallResult<T>> {
  const total = Math.max(1, opts.attempts ?? 1);
  const original = opts.messages;
  let attemptMessages = original;
  let attemptProvider = opts.provider;
  let attemptFallback = opts.fallback ?? null;
  let usage = { input: 0, output: 0 };
  let made = 0;
  let providerName = opts.provider.name;
  const errors: Error[] = [];

  for (let attempt = 0; attempt < total; attempt += 1) {
    const out = await chatWithFallback(attemptProvider, attemptFallback, {
      messages: attemptMessages,
      ...(opts.request?.model !== undefined
        ? { model: opts.request.model }
        : {}),
      ...(opts.request?.temperature !== undefined
        ? { temperature: opts.request.temperature }
        : {}),
      ...(opts.request?.response_format !== undefined
        ? { response_format: opts.request.response_format }
        : {}),
    });
    made = attempt + 1;
    providerName = out.provider;
    usage.input += out.response.usage.input;
    usage.output += out.response.usage.output;
    try {
      const data = opts.parse(out.response.content, out.provider);
      return {
        data,
        usage,
        providerName: out.provider,
        messages: original,
        attempts: made,
      };
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
      const next = opts.nextAttempt?.(
        errors[errors.length - 1]!,
        attempt,
        out.provider,
      );
      if (next === undefined || next === null) break;
      attemptMessages = next.messages;
      attemptProvider = next.provider ?? opts.provider;
      attemptFallback = next.provider ? null : (opts.fallback ?? null);
    }
  }

  const failure = errors[errors.length - 1] ?? new Error("no attempt was made");
  throw opts.onFailure ? opts.onFailure(errors, providerName, made) : failure;
}

/** The schema-shaped convenience wrapper: a zod-style schema, a label for
 *  the error message, and the agent's error class. */
export async function callStructuredAgent<T>(opts: {
  messages: ChatMessage[];
  provider: Provider;
  fallback?: Provider | null;
  schema: SafeParseSchema<T>;
  /** Label in schema-error messages, e.g. "Script schema". */
  schemaLabel: string;
  /** Each agent's error class is part of its public interface; the
   *  runtime throws through this factory. */
  toError: (message: string, providerName: string, cause?: unknown) => Error;
  /** Extra ChatRequest fields (model / temperature / response_format). */
  request?: {
    model?: string;
    temperature?: number;
    response_format?: { type: "json_object" | "text" };
  };
}): Promise<StructuredAgentResult<T>> {
  const r = await callStructured<T>({
    messages: opts.messages,
    provider: opts.provider,
    fallback: opts.fallback ?? null,
    parse: structuredYamlParser({
      schema: opts.schema,
      schemaLabel: opts.schemaLabel,
      toError: opts.toError,
    }),
    ...(opts.request !== undefined ? { request: opts.request } : {}),
  });
  return {
    data: r.data,
    usage: r.usage,
    providerName: r.providerName,
    messages: r.messages,
  };
}

/** Extract the model's structured YAML answer: strip a reasoning model's
 *  `<think>` block first (its sketch is not the answer — see
 *  `stripReasoning`), then take the first fenced ```yaml block, or the
 *  trimmed whole text when unfenced. */
export function extractFencedYaml(content: string): string {
  const out = stripReasoning(content);
  const fence = /```(?:yaml)?\s*([\s\S]*?)```/m;
  const match = out.match(fence);
  if (match && match[1]) return match[1].trim();
  return out.trim();
}

/**
 * The text a reply meant to carry: reasoning removed, and a single
 * wrapping code fence removed.
 *
 * Both removals happen here so no caller can forget them — a reasoning
 * model's sketch, read as the answer, is the bug this whole module exists
 * to prevent.
 */
export function extractReplyBody(content: string): string {
  const out = stripReasoning(content).trim();
  const fence = /^```(?:json|yaml)?\s*\n?([\s\S]*?)\n?```\s*$/;
  const match = out.match(fence);
  if (match && match[1] !== undefined) return match[1].trim();
  return out;
}

/**
 * The JSON body of a reply, whatever the model wrapped it in: the strict
 * body, or the largest balanced `{...}` object inside it.
 *
 * Returns null when the reply carries no JSON at all.
 */
export function extractJsonObject(content: string): string | null {
  const body = extractReplyBody(content);
  if (!body) return null;
  try {
    JSON.parse(body);
    return body;
  } catch {
    // Not a bare JSON document — look for an object inside it.
  }
  return extractBalancedJson(body);
}

/** Find the first balanced JSON object substring. Handles strings (with
 *  escape sequences), escaped backslashes, and nested objects. Returns
 *  `null` if no balanced object is found.
 *
 *  The reasoning is stripped first: a reasoning model emits its sketch
 *  before the answer, and the sketch is a JSON object too. */
export function extractBalancedJson(text: string): string | null {
  const source = stripReasoning(text);
  let start = -1;
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escapeNext) escapeNext = false;
      else if (ch === "\\") escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start >= 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** zod issues in the `a.b: message; c: message` form every agent used. */
export function formatSchemaIssues(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): string {
  return error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
}

/** One-shot content → validated data. Extracts, parses, and validates; on
 *  any failure throws through `toError` so each agent keeps its own error
 *  class. */
export function parseStructuredYaml<T>(
  content: string,
  providerName: string,
  opts: {
    schema: SafeParseSchema<T>;
    schemaLabel: string;
    toError: (message: string, providerName: string, cause?: unknown) => Error;
  },
): T {
  const yamlText = extractFencedYaml(content);
  if (!yamlText) {
    throw opts.toError("no YAML in response", providerName);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    throw opts.toError(
      `YAML parse failed: ${(err as Error).message}`,
      providerName,
      err,
    );
  }
  const result = opts.schema.safeParse(parsed);
  if (!result.success) {
    throw opts.toError(
      `${opts.schemaLabel} invalid: ${formatSchemaIssues(result.error)}`,
      providerName,
      result.error,
    );
  }
  return result.data;
}

/** The schema path as a parser, so an agent can hand it to `callStructured`
 *  and keep its own retry policy around it. */
export function structuredYamlParser<T>(opts: {
  schema: SafeParseSchema<T>;
  schemaLabel: string;
  toError: (message: string, providerName: string, cause?: unknown) => Error;
}): StructuredParser<T> {
  return (content, providerName) =>
    parseStructuredYaml(content, providerName, opts);
}
