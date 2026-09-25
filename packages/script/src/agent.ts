import type { Provider } from "@vf/llm";
import { chatWithFallback } from "@vf/llm";
import { parse as parseYaml } from "yaml";
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
}

export function extractYaml(content: string): string {
  const fence = /```(?:yaml)?\s*([\s\S]*?)```/m;
  const match = content.match(fence);
  if (match && match[1]) return match[1].trim();
  return content.trim();
}

export async function callScript(
  input: ScriptInput,
  provider: Provider,
  fallback?: Provider | null,
): Promise<CallScriptResult> {
  const messages = buildScriptMessages(input);
  const out = await chatWithFallback(provider, fallback ?? null, { messages });
  const res = out.response;
  const actualProvider = out.provider;
  const yamlText = extractYaml(res.content);
  if (!yamlText) {
    throw new ScriptError("no YAML in response", actualProvider);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    throw new ScriptError(
      `YAML parse failed: ${(err as Error).message}`,
      actualProvider,
      err,
    );
  }
  const result = ScriptSchema.safeParse(parsed);
  if (!result.success) {
    throw new ScriptError(
      `Script schema invalid: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      actualProvider,
      result.error,
    );
  }
  return { script: result.data, usage: res.usage, providerName: actualProvider };
}
