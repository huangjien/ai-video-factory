import type { ChatMessage, Provider } from "@video/llm";
import { callStructuredAgent } from "@video/llm";
import { buildScriptMessages, type ScriptInput } from "./prompt.js";
import { ScriptSchema, type Script } from "./schemas.js";

export class ScriptError extends Error {
  override readonly cause: unknown;
  constructor(
    message: string,
    public readonly providerName: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "ScriptError";
    this.cause = cause;
  }
}

export interface CallScriptResult {
  script: Script;
  usage: { input: number; output: number };
  /** Name of the provider that actually served the request
   * (primary or its fallback, per `chatWithFallback`). */
  providerName: string;
  /** The exact messages sent to the provider — lets callers hash the
   * real prompt for run-record `prompt_hash`. */
  messages: ChatMessage[];
}

export async function callScript(
  input: ScriptInput,
  provider: Provider,
  fallback?: Provider | null,
): Promise<CallScriptResult> {
  const r = await callStructuredAgent({
    messages: buildScriptMessages(input),
    provider,
    fallback: fallback ?? null,
    schema: ScriptSchema,
    schemaLabel: "Script schema",
    toError: (message, providerName, cause) =>
      new ScriptError(message, providerName, cause),
  });
  return {
    script: r.data,
    usage: r.usage,
    providerName: r.providerName,
    messages: r.messages,
  };
}
