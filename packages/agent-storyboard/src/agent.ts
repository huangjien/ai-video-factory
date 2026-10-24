import type { ChatMessage, Provider } from "@video/llm";
import { chatWithFallback, extractFencedYaml } from "@video/llm";
import { validateStoryboard } from "@video/vdsl/validate.js";
import type { Storyboard } from "@video/vdsl/schema.js";
import { buildMessages, type AgentInput } from "./prompt.js";

export interface AgentResult {
  storyboard: Storyboard;
  usage: { input: number; output: number };
  /** Name of the provider that actually served the request
   * (primary or its fallback, per `chatWithFallback`). */
  providerName: string;
  /** The exact messages sent to the provider — lets callers hash the
   * real prompt for run-record `prompt_hash`. */
  messages: ChatMessage[];
  /** True when the first response failed VDSL validation and a repair pass
   *  fixed it. Lets callers see the recovery; costs one extra call. */
  repaired: boolean;
}

export class AgentError extends Error {
  override readonly cause: unknown;
  constructor(
    message: string,
    public readonly providerName: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "AgentError";
    this.cause = cause;
  }
}

/** Strip ```yaml fences via the shared extractor in @video/llm (reasoning
 *  stripping included — a thinking model's sketch is never the answer). */
export function extractYaml(content: string): string {
  return extractFencedYaml(content);
}

/** How many repair passes to attempt after a validation failure. One is
 *  deliberate: the failure is almost always one invented key or one unknown
 *  enum value, and the validator names exactly which - a second blind attempt
 *  would only cost another call. */
const REPAIR_ATTEMPTS = 1;

export interface ValidationError {
  field: string;
  message: string;
}

/** Flatten validator issues to the `field: message` form used in the repair
 *  prompt and in the thrown error. */
function formatErrors(errors: ValidationError[]): string {
  return errors.map((e) => `- ${e.field}: ${e.message}`).join("\n");
}

/** One repair request: the original messages plus the exact validator
 *  complaints. The model is told to change nothing but the listed fields, so a
 *  repair cannot silently rewrite the storyboard's content. */
export function buildRepairMessages(
  messages: ChatMessage[],
  errors: ValidationError[],
): ChatMessage[] {
  return [
    ...messages,
    {
      role: "user",
      content: [
        "Your storyboard.yaml failed VDSL validation. Errors:",
        formatErrors(errors),
        "",
        "Emit the COMPLETE storyboard again, with only these problems fixed.",
        "Rules for the retry:",
        "- VDSL is strict: any key not in the schema is an error. Never invent keys.",
        "- Remove an unknown key rather than renaming or zeroing it.",
        "- animation.entrance must be exactly one of: none, fade, slide, scale, draw, typewriter.",
        "- Change nothing else - same topic, same scenes, same narration.",
        "",
        "Reply with the single fenced YAML block and nothing else.",
      ].join("\n"),
    },
  ];
}

export async function callAgent(
  input: AgentInput,
  provider: Provider,
  opts: { model?: string; temperature?: number } = {},
  fallback?: Provider | null,
): Promise<AgentResult> {
  const messages = buildMessages(input);
  const baseReq = {
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.temperature !== undefined
      ? { temperature: opts.temperature }
      : {}),
  };
  let attemptMessages = messages;
  let usage = { input: 0, output: 0 };
  let repaired = false;

  for (let attempt = 0; attempt <= REPAIR_ATTEMPTS; attempt += 1) {
    const out = await chatWithFallback(provider, fallback ?? null, {
      messages: attemptMessages,
      ...baseReq,
    });
    usage.input += out.response.usage.input;
    usage.output += out.response.usage.output;

    const yamlText = extractYaml(out.response.content);
    if (!yamlText) {
      throw new AgentError("no YAML in response", out.provider);
    }
    const result = validateStoryboard(yamlText, "storyboard.yaml");
    if (result.ok) {
      return {
        storyboard: result.data,
        usage,
        providerName: out.provider,
        // Always the ORIGINAL messages: run-record prompt_hash must describe
        // the prompt, not the repair scaffolding appended to it.
        messages,
        repaired,
      };
    }
    if (attempt === REPAIR_ATTEMPTS) {
      throw new AgentError(
        `VDSL validation failed after ${REPAIR_ATTEMPTS} repair attempt(s): ${formatErrors(result.errors)}`,
        out.provider,
        result.errors,
      );
    }
    repaired = true;
    attemptMessages = buildRepairMessages(messages, result.errors);
  }

  // Unreachable: the loop returns or throws on its final iteration.
  throw new AgentError("unreachable", provider.name);
}
