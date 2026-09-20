import type { Provider } from "@vf/llm";
import { validateStoryboard } from "@vf/vdsl/validate.js";
import type { Storyboard } from "@vf/vdsl/schema.js";
import { buildMessages, type AgentInput } from "./prompt.js";

export interface AgentResult {
  storyboard: Storyboard;
  usage: { input: number; output: number };
  providerName: string;
}

export class AgentError extends Error {
  override readonly cause: unknown;
  constructor(message: string, public readonly providerName: string, cause?: unknown) {
    super(message);
    this.name = "AgentError";
    this.cause = cause;
  }
}

/** Strip ```yaml or ``` ... ``` fences around the model's output so we
 * can parse the inner YAML reliably regardless of the model's habit. */
export function extractYaml(content: string): string {
  const fence = /```(?:yaml)?\s*([\s\S]*?)```/m;
  const match = content.match(fence);
  if (match && match[1]) return match[1].trim();
  return content.trim();
}

export async function callAgent(
  input: AgentInput,
  provider: Provider,
  opts: { model?: string; temperature?: number } = {},
): Promise<AgentResult> {
  const messages = buildMessages(input);
  const res = await provider.chat({
    messages,
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  });
  const yamlText = extractYaml(res.content);
  if (!yamlText) {
    throw new AgentError("no YAML in response", provider.name);
  }
  const result = validateStoryboard(yamlText, "storyboard.yaml");
  if (!result.ok) {
    throw new AgentError(
      `VDSL validation failed: ${result.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
      provider.name,
      result.errors,
    );
  }
  return {
    storyboard: result.data,
    usage: res.usage,
    providerName: provider.name,
  };
}
