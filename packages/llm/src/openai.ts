import type {
  ChatError,
  ChatRequest,
  ChatResponse,
  Provider,
  ProviderTelemetry,
} from "./provider.js";
import { LLM_TIMEOUT_MS } from "./timeout.js";
import { chatStream, isHeadersTimeout } from "./stream.js";
import { llmFetch } from "./http.js";

export interface OpenAIProviderOptions {
  baseUrl?: string | undefined;
  defaultModel?: string | undefined;
}

const DEFAULT_BASE = "https://api.openai.com/v1";
/** The chat API's `gpt-6.x` lines (the Decisions endpoint serves
 *  `gpt-6-luna` only — see decision/openai.ts). `gpt-6.1-sol` is the
 *  model the repo's reviewer role names; override with OPENAI_MODEL. */
const DEFAULT_MODEL = "gpt-6.1-sol";

/** OpenAI-compatible chat client.
 * Endpoint: `${baseUrl}/chat/completions` · Auth: Bearer `OPENAI_API_KEY`
 *
 * Same wire protocol as GLM (both speak OpenAI chat completions), so the
 * response parsing is the same shape — but a separate class: the
 * endpoints, keys and model ids differ, and the draft pool needs to
 * tell the providers apart by name.
 */
export class OpenAIProvider implements Provider {
  readonly name = "openai";
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(opts: OpenAIProviderOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env["OPENAI_BASE_URL"] ?? DEFAULT_BASE;
    this.defaultModel =
      opts.defaultModel ?? process.env["OPENAI_MODEL"] ?? DEFAULT_MODEL;
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
    const key = process.env["OPENAI_API_KEY"];
    if (!key) {
      const err = new Error("OPENAI_API_KEY not set in environment") as ChatError;
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
      // `thinking` is not an OpenAI field; the chat API has no switch for
      // it. Dropped deliberately (the same reasoning as GLM's provider).
    };
    let body: string;
    try {
      telemetry.requests += 1;
      const res = await llmFetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
      if (!res.ok) {
        const excerpt = (await res.text()).slice(0, 200);
        const err = new Error(
          `OpenAI API ${res.status}: ${excerpt.slice(0, 80)}`,
        ) as ChatError;
        err.provider = this.name;
        err.status = res.status;
        err.body_excerpt = excerpt;
        throw err;
      }
      body = await res.text();
    } catch (err) {
      if (err !== null && typeof err === "object") {
        (err as ChatError).telemetry = { ...telemetry };
      }
      // A headers timeout is re-issued as a STREAM — the stream sends
      // headers immediately, so a slow first byte stops being fatal.
      if (!isHeadersTimeout(err)) throw err;
      telemetry.requests += 1;
      telemetry.streams += 1;
      telemetry.headersTimeoutRetries += 1;
      const streamed = await chatStream({
        url: `${this.baseUrl}/chat/completions`,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: requestBody,
        timeoutMs: LLM_TIMEOUT_MS,
      });
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
      const err = new Error("OpenAI response missing content") as ChatError;
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
