import type {
  ChatError,
  ChatRequest,
  ChatResponse,
  Provider,
} from "./provider.js";
import { LLM_TIMEOUT_MS } from "./timeout.js";
import { chatStream, isHeadersTimeout } from "./stream.js";

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
    };
    let body: string;
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(requestBody),
        // AbortSignal.timeout replaces the previous custom-undici-dispatcher
        // hack. Node 22+ global fetch rejects third-party undici Agent
        // instances with UND_ERR_INVALID_ARG; the built-in AbortSignal
        // is portable and works on all Node versions that ship global fetch.
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
      // The server buffers a long completion before it sends response
      // headers, and undici gives up waiting at 300 s regardless of our
      // own AbortSignal. Re-issue the same request as a STREAM, which
      // sends headers immediately — see packages/llm/src/stream.ts.
      if (!isHeadersTimeout(err)) throw err;
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
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = parsed.choices[0]?.message.content;
    if (typeof content !== "string") {
      const err = new Error("GLM response missing content") as ChatError;
      err.provider = this.name;
      err.body_excerpt = body.slice(0, 200);
      throw err;
    }
    return {
      content,
      usage: {
        input: parsed.usage?.prompt_tokens ?? 0,
        output: parsed.usage?.completion_tokens ?? 0,
      },
    };
  }
}
