import { parse as parseYaml } from "yaml";
import type { ChatMessage, Provider } from "./provider.js";
import { chatWithFallback } from "./retry.js";
import { stripReasoning } from "./stream.js";

/**
 * The structured-agent runtime — the one call loop every LLM agent shares:
 * chat (with retry/fallback) → extract the answer → parse → validate.
 *
 * Before this module, nine sibling agents each carried a private copy of
 * that loop. The copies drifted: the reasoning-strip fix (a model's
 * `<think>` sketch mistaken for the answer) landed in @video/youtube and
 * @video/draft but not in script/review/research/storyboard/motion, where
 * the same bug lived on. Extraction now ALWAYS strips reasoning first.
 *
 * What stays per-agent: the prompt (`packages/prompts`), the zod schema,
 * the error class (each package's public interface — the runtime throws
 * through a `toError` factory), and any post-validation domain checks.
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

/** Find the first balanced JSON object substring. Handles strings (with
 *  escape sequences), escaped backslashes, and nested objects. Returns
 *  `null` if no balanced object is found. */
export function extractBalancedJson(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
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
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
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
 *  class. Agents with their own retry/degrade policy (youtube's
 *  fallback-provider retry, bilibili's degrade) call this inside their
 *  policy loop instead of the whole `callStructuredAgent`. */
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

/** The shared single-shot agent call: chat with retry/fallback, then
 *  extract + parse + validate through the same rules everywhere. */
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
  const out = await chatWithFallback(opts.provider, opts.fallback ?? null, {
    messages: opts.messages,
    ...(opts.request?.model !== undefined ? { model: opts.request.model } : {}),
    ...(opts.request?.temperature !== undefined
      ? { temperature: opts.request.temperature }
      : {}),
    ...(opts.request?.response_format !== undefined
      ? { response_format: opts.request.response_format }
      : {}),
  });
  const data = parseStructuredYaml(out.response.content, out.provider, {
    schema: opts.schema,
    schemaLabel: opts.schemaLabel,
    toError: opts.toError,
  });
  return {
    data,
    usage: out.response.usage,
    providerName: out.provider,
    messages: opts.messages,
  };
}
