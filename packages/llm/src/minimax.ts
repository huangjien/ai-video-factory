import type {
  ChatError,
  ChatRequest,
  ChatResponse,
  Provider,
} from "./provider.js";

export interface MiniMaxProviderOptions {
  apiHost?: string | undefined;
  defaultModel?: string | undefined;
}

const DEFAULT_MODEL = "MiniMax-M2.7";

/** OpenAI-compatible MiniMax chat client.
 * Endpoint: `${apiHost}/v1/chat/completions` · Auth: Bearer `MINIMAX_API_KEY`
 * Source: https://platform.minimax.io/docs/api-reference/text-chat-openai
 */
export class MiniMaxProvider implements Provider {
  readonly name = "minimax";
  private readonly apiHost: string;
  private readonly defaultModel: string;

  constructor(opts: MiniMaxProviderOptions = {}) {
    this.apiHost = opts.apiHost ?? process.env["MINIMAX_API_HOST"] ?? "https://api.minimax.io";
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const key = process.env["MINIMAX_API_KEY"];
    if (!key) {
      const err = new Error("MINIMAX_API_KEY not set in environment") as ChatError;
      err.provider = this.name;
      throw err;
    }
    const res = await fetch(`${this.apiHost}/v1/chat/completions`, {
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
        `MiniMax API ${res.status}: ${excerpt.slice(0, 80)}`,
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
      const err = new Error("MiniMax response missing content") as ChatError;
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
