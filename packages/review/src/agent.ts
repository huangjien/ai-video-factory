import type { ChatMessage, Provider } from "@video/llm";
import { callStructuredAgent } from "@video/llm";
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

export async function callReview(
  input: ReviewInput,
  provider: Provider,
  fallback?: Provider | null,
): Promise<CallReviewResult> {
  const r = await callStructuredAgent({
    messages: buildReviewMessages(input),
    provider,
    fallback: fallback ?? null,
    schema: ReviewPackageSchema,
    schemaLabel: "Review package schema",
    toError: (message, providerName, cause) =>
      new ReviewError(message, providerName, cause),
  });
  return {
    review: r.data,
    usage: r.usage,
    providerName: r.providerName,
    messages: r.messages,
  };
}
