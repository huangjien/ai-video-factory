import type { ChatMessage, Provider } from "@video/llm";
import {
  callStructured,
  structuredYamlParser,
  type SafeParseSchema,
} from "@video/llm";
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
  const messages = buildReviewMessages(input);
  const r = await callStructured<ReviewPackage>({
    messages,
    provider,
    fallback: fallback ?? null,
    parse: structuredYamlParser({
      schema: ReviewPackageSchema,
      schemaLabel: "Review package schema",
      toError: (message, providerName, cause) =>
        new ReviewError(message, providerName, cause),
    }),
    attempts: 2,
    nextAttempt: (_error, attempt, servedBy) => {
      // The provider ANSWERED; the answer just did not fit the schema.
      // That is a content failure, not a provider outage, so
      // chatWithFallback never engages the fallback provider — the run
      // dies on one model's formatting. Give the fallback a turn before
      // failing: a different model rarely repeats the same mistake.
      // (Same policy as the youtube packager.)
      if (attempt > 0) return null;
      if (!fallback) return null;
      // Asking the fallback again would only repeat the same answer.
      if (servedBy === fallback.name) return null;
      return { messages, provider: fallback };
    },
    onFailure: (errors) =>
      // A PARSE failure is reported with the PRIMARY's error: a fallback
      // that also failed to fit the schema is a symptom, not the
      // diagnosis. A chat failure of both providers never reaches here —
      // it surfaces with the last provider's own error.
      errors[0]!,
  });
  return {
    review: r.data,
    usage: r.usage,
    providerName: r.providerName,
    messages: r.messages,
  };
}
