import type {
  ChatError,
  ChatRequest,
  ChatResponse,
  Provider,
} from "./provider.js";

export interface GLMProviderOptions {
  baseUrl?: string | undefined;
  defaultModel?: string | undefined;
}

const DEFAULT_BASE = "https://api.z.ai/api/coding/paas/v4";
const DEFAULT_MODEL = "glm-4.6";

/** OpenAI-compatible GLM Coding Plan chat client.
 * Endpoint: `${baseUrl}/chat/completions` · Auth: Bearer `GLM_API_KEY`
 * Source: https://docs.z.ai/devpack/tool/others (OpenAI Chat Completions base)
 */
export class GLMProvider implements Provider {
  readonly name = "glm";
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(opts: GLMProviderOptions = {}) {
    this.baseUrl =
      opts.baseUrl ??
      process.env["GLM_BASE_URL"] ??
      DEFAULT_BASE;
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const key = process.env["GLM_API_KEY"];
    if (!key) {
      const err = new Error("GLM_API_KEY not set in environment") as ChatError;
      err.provider = this.name;
      throw err;
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: req.model ?? this.defaultModel,
        messages: req.messages,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      const excerpt = body.slice(0, 200);
      const err = new Error(
        `GLM API ${res.status}: ${excerpt.slice(0, 80)}`,
      ) as ChatError;
      err.provider = this.name;
      err.status = res.status;
      err.body_excerpt = excerpt;
      throw err;
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
