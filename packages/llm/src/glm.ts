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

export interface GLMProviderOptions {
  baseUrl?: string | undefined;
  defaultModel?: string | undefined;
}

// Zhipu paas/v4 (OpenAI-compatible). The GLM Coding Plan endpoint
// (api.z.ai/api/coding/paas/v4) uses the same protocol but is tied to a
// separate Coding Plan balance; override via GLM_BASE_URL to switch.
const DEFAULT_BASE = "https://open.bigmodel.cn/api/coding/paas/v4";
const DEFAULT_MODEL = "glm-5.3";

/** OpenAI-compatible GLM (Zhipu) chat client.
 * Endpoint: `${baseUrl}/chat/completions` · Auth: Bearer `GLM_API_KEY`
 */
export class GLMProvider implements Provider {
  readonly name = "glm";
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(opts: GLMProviderOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env["GLM_BASE_URL"] ?? DEFAULT_BASE;
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
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
    const key = process.env["GLM_API_KEY"];
    if (!key) {
      const err = new Error("GLM_API_KEY not set in environment") as ChatError;
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
      // `thinking` is deliberately NOT sent: GLM-5.3 forces thinking and
      // rejects `{"type":"disabled"}` (docs.bigmodel.cn — 思考模式),
      // so a request that honours it would fail the call. The judge
      // asks for no reasoning; GLM reasons anyway, and the telemetry
      // records how many tokens that cost.
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
        // The header wait is bounded by the shared Agent (see
        // packages/llm/src/http.ts), not by undici's 300 s default.
        // `AbortSignal.timeout` is the outer bound on the whole request.
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
      if (!res.ok) {
        const excerpt = (await res.text()).slice(0, 200);
        const err = new Error(
          `GLM API ${res.status}: ${excerpt.slice(0, 80)}`,
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
      const err = new Error("GLM response missing content") as ChatError;
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
