export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string | undefined;
  temperature?: number | undefined;
  /** OpenAI-compatible structured-output hint; ignored by providers
   * that don't support it. Currently honored by GLMProvider. */
  response_format?: { type: "json_object" | "text" } | undefined;
  /** Turn the model's hidden reasoning off (or on).
   *
   *  A reasoning model spends most of its output tokens THINKING: the
   *  article judge measured 31,916 output tokens for a 10,183-character
   *  scorecard — 91% of the answer was reasoning nobody reads, and it
   *  was most of the wall clock too.
   *
   *  A provider that cannot honour this ignores it — GLM-5.3 forces
   *  thinking and rejects `{"type":"disabled"}`, so the GLM provider
   *  deliberately drops the field rather than sending it. */
  thinking?: "enabled" | "disabled" | undefined;
}

export interface Usage {
  input: number;
  output: number;
}

/** What one provider call actually did on the wire.
 *
 * The draft loop burns ten LLM calls per film, and until this existed
 * there was no way to tell a slow model from a request the client had
 * already doomed: the run records carried tokens but no timings, and
 * `duration_ms` was measured around the wrapper rather than the work.
 *
 * `headersTimeoutRetries` is the important one — it counts requests
 * that were thrown away because the client gave up waiting for headers
 * and had to ask again. It is 0 on a healthy run (see
 * packages/llm/src/http.ts for why it used not to be). */
export interface ProviderTelemetry {
  /** HTTP requests issued for this call (a retry is another one). */
  requests: number;
  /** How many of those were streamed (headers arrive immediately). */
  streams: number;
  /** Non-stream requests lost to a headers timeout and re-issued. */
  headersTimeoutRetries: number;
  /** Output tokens the model spent THINKING rather than answering.
   *  This is the honest measure of the reasoning overhead: on a
   *  reasoning model it is usually the majority of the output. */
  reasoningTokens: number;
  /** Wall-clock milliseconds the call took. */
  durationMs: number;
}

/** A call with no telemetry yet — the shape a mock provider returns. */
export function emptyTelemetry(): ProviderTelemetry {
  return {
    requests: 0,
    streams: 0,
    headersTimeoutRetries: 0,
    reasoningTokens: 0,
    durationMs: 0,
  };
}

/** Add two telemetry records (the structured-agent loop sums them
 *  across attempts). */
export function addTelemetry(
  a: ProviderTelemetry | undefined,
  b: ProviderTelemetry | undefined,
): ProviderTelemetry {
  const left = a ?? emptyTelemetry();
  const right = b ?? emptyTelemetry();
  return {
    requests: left.requests + right.requests,
    streams: left.streams + right.streams,
    headersTimeoutRetries:
      left.headersTimeoutRetries + right.headersTimeoutRetries,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    durationMs: left.durationMs + right.durationMs,
  };
}

export interface ChatResponse {
  content: string;
  usage: Usage;
  /** What the call did on the wire — absent on mock providers. */
  telemetry?: ProviderTelemetry | undefined;
}

export interface ChatError extends Error {
  provider: string;
  status?: number | undefined;
  body_excerpt?: string | undefined;
  /** What the failed attempt had done on the wire when it threw.
   *  Without it a discarded request vanishes from the accounting: the
   *  retry layer could not tell a first-attempt failure from a
   *  third-attempt failure, so the wasted work was invisible. */
  telemetry?: ProviderTelemetry | undefined;
}

export interface Provider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}
