import type {
  ChatError,
  ChatRequest,
  ChatResponse,
  Provider,
  ProviderTelemetry,
} from "./provider.js";
import { LLM_TIMEOUT_MS } from "./timeout.js";
import { chatStream, isHeadersTimeout } from "./stream.js";
import { defaultModel } from "./config.js";
import { llmFetch } from "./http.js";

export interface MiniMaxProviderOptions {
  apiHost?: string | undefined;
  defaultModel?: string | undefined;
}

/** OpenAI-compatible MiniMax chat client.
 * Endpoint: `${apiHost}/v1/chat/completions` · Auth: Bearer `MINIMAX_API_KEY`
 * Source: https://platform.minimax.io/docs/api-reference/text-chat-openai
 */
export class MiniMaxProvider implements Provider {
  readonly name = "minimax";
  private readonly apiHost: string;
  private readonly defaultModel: string;

  constructor(opts: MiniMaxProviderOptions = {}) {
    this.apiHost =
      opts.apiHost ??
      process.env["MINIMAX_API_HOST"] ??
      "https://api.minimax.io";
    this.defaultModel = opts.defaultModel ?? defaultModel("chat", "minimax");
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const started = Date.now();
    const telemetry: ProviderTelemetry = {
      requests: 0,
      streams: 0,
      headersTimeoutRetries: 0,
      reasoningTokens: 0,
      durationMs: 0,
    };
    const key = process.env["MINIMAX_API_KEY"];
    if (!key) {
      const err = new Error(
        "MINIMAX_API_KEY not set in environment",
      ) as ChatError;
      err.provider = this.name;
      throw err;
    }
    const requestBody = {
      model: req.model ?? this.defaultModel,
      messages: req.messages,
      ...(req.temperature !== undefined
        ? { temperature: req.temperature }
        : {}),
      ...(req.response_format ? { response_format: req.response_format } : {}),
      // MiniMax-M3 skips thinking and answers directly when thinking is
      // disabled (platform.minimax.io/docs/api-reference/text-openai-api
      // — "Thinking Control"). The judge does not need 30k tokens of
      // hidden analysis to fill in a rubric.
      ...(req.thinking !== undefined
        ? { thinking: { type: req.thinking } }
        : {}),
    };
    let body: string;
    try {
      telemetry.requests += 1;
      const res = await llmFetch(`${this.apiHost}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(requestBody),
        // The header wait is bounded by the shared Agent (see
        // packages/llm/src/http.ts), not by undici's 300 s default.
        // `AbortSignal.timeout` is the outer bound on the whole request.
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
      if (!res.ok) {
        const excerpt = (await res.text()).slice(0, 200);
        const err = new Error(
          `MiniMax API ${res.status}: ${excerpt.slice(0, 80)}`,
        ) as ChatError;
        err.provider = this.name;
        err.status = res.status;
        err.body_excerpt = excerpt;
        throw err;
      }
      body = await res.text();
    } catch (err) {
      // Keep the wire-level detail with the error: the retry layer
      // accounts for the requests a failed attempt burned, so a
      // discarded request is never invisible.
      if (err !== null && typeof err === "object") {
        (err as ChatError).telemetry = { ...telemetry };
      }
      // Safety net only: with the raised ceiling the header wait no
      // longer expires at 300 s, so this path should be unreachable.
      // If a provider ever does stall that long, re-issue the request as
      // a STREAM, which sends headers immediately — see
      // packages/llm/src/stream.ts.
      if (!isHeadersTimeout(err)) throw err;
      telemetry.requests += 1;
      telemetry.streams += 1;
      telemetry.headersTimeoutRetries += 1;
      // MiniMax follows the OpenAI streaming contract: usage is only
      // included when stream_options asks for it. Without this the
      // fallback fabricated usage 0/0 — run records showed
      // "judge_tokens=0+0" for every judge call that hit this path
      // (2026-11-04).
      const streamBody = {
        ...requestBody,
        stream_options: { include_usage: true },
      };
      const streamed = await chatStream({
        url: `${this.apiHost}/v1/chat/completions`,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: streamBody,
        timeoutMs: LLM_TIMEOUT_MS,
      });
      if (streamed.usage.input === 0 && streamed.usage.output === 0) {
        // The provider ignored stream_options (or the stream ended before
        // any usage frame) — say so instead of writing a fabricated 0/0
        // into run records.
        console.error(
          "warning: MiniMax streamed response carried no usage — token accounting for this call is unknown",
        );
      }
      body = JSON.stringify({
        choices: [{ message: { content: streamed.content } }],
        usage: {
          prompt_tokens: streamed.usage.input,
          completion_tokens: streamed.usage.output,
        },
      });
    }
    const parsed = JSON.parse(body) as {
      choices: { message: { content: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const content = parsed.choices[0]?.message.content;
    if (typeof content !== "string") {
      const err = new Error("MiniMax response missing content") as ChatError;
      err.provider = this.name;
      err.body_excerpt = body.slice(0, 200);
      err.telemetry = { ...telemetry };
      throw err;
    }
    telemetry.reasoningTokens =
      parsed.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    telemetry.durationMs = Date.now() - started;
    return {
      content,
      usage: {
        input: parsed.usage?.prompt_tokens ?? 0,
        output: parsed.usage?.completion_tokens ?? 0,
      },
      telemetry,
    };
  }
}
