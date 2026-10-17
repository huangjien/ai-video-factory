import type { ChatMessage, Provider } from "@video/llm";
import { chatWithFallback } from "@video/llm";
import { parse as parseYaml } from "yaml";
import { ReviewPackageSchema, type ReviewPackage } from "./schemas.js";
import { buildReviewMessages, type ReviewInput } from "./prompt.js";

export { SYSTEM_PROMPT } from "./prompt.js";

export class ReviewError extends Error {
  override readonly cause: unknown;
  constructor(
    message: string,
    public readonly providerName: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "ReviewError";
    this.cause = cause;
  }
}

export interface CallReviewResult {
  review: ReviewPackage;
  usage: { input: number; output: number };
  /** Name of the provider that actually served the request
   * (primary or its fallback, per `chatWithFallback`). */
  providerName: string;
  /** The exact messages sent to the provider — lets callers hash the
   * real prompt for run-record `prompt_hash`. */
  messages: ChatMessage[];
}

export function extractYaml(content: string): string {
  const fence = /```(?:yaml)?\s*([\s\S]*?)```/m;
  const match = content.match(fence);
  if (match && match[1]) return match[1].trim();
  return content.trim();
}

export async function callReview(
  input: ReviewInput,
  provider: Provider,
  fallback?: Provider | null,
): Promise<CallReviewResult> {
  const messages = buildReviewMessages(input);
  const out = await chatWithFallback(provider, fallback ?? null, { messages });
  const res = out.response;
  const actualProvider = out.provider;
  const yamlText = extractYaml(res.content);
  if (!yamlText) {
    throw new ReviewError("no YAML in response", actualProvider);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    throw new ReviewError(
      `YAML parse failed: ${(err as Error).message}`,
      actualProvider,
      err,
    );
  }
  const result = ReviewPackageSchema.safeParse(parsed);
  if (!result.success) {
    throw new ReviewError(
      `Review package schema invalid: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      actualProvider,
      result.error,
    );
  }
  return {
    review: result.data,
    usage: res.usage,
    providerName: actualProvider,
    messages,
  };
}
