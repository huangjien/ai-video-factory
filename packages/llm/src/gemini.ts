import type {
  ChatError,
  ChatRequest,
  ChatResponse,
  Provider,
  ProviderTelemetry,
} from "./provider.js";
import { LLM_TIMEOUT_MS } from "./timeout.js";
import { llmFetch } from "./http.js";

export interface GeminiProviderOptions {
  baseUrl?: string | undefined;
  defaultModel?: string | undefined;
}

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
/** The current stable flash flagship (the repo's image model is the
 *  `gemini-3.1-flash-image` sibling); override with GEMINI_MODEL. */
const DEFAULT_MODEL = "gemini-3.5-flash";

/** Google Gemini chat client.
 * Endpoint: `${baseUrl}/models/{model}:generateContent` ·
 * Auth: `x-goog-api-key: GEMINI_API_KEY`
 *
 * The wire shape is NOT OpenAI-compatible: messages become `contents`
 * with `parts`, the system message is a separate `systemInstruction`,
 * and the usage counters are named `promptTokenCount` /
 * `candidatesTokenCount`. Structured output is a MIME type on the
 * response, not a `response_format` object.
 */
export class GeminiProvider implements Provider {
  readonly name = "gemini";
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(opts: GeminiProviderOptions = {}) {
    this.baseUrl =
      opts.baseUrl ?? process.env["GEMINI_BASE_URL"] ?? DEFAULT_BASE;
    this.defaultModel =
      opts.defaultModel ?? process.env["GEMINI_MODEL"] ?? DEFAULT_MODEL;
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
    const key = process.env["GEMINI_API_KEY"];
    if (!key) {
      const err = new Error("GEMINI_API_KEY not set in environment") as ChatError;
      err.provider = this.name;
      throw err;
    }
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    const model = req.model ?? this.defaultModel;
    // One generationConfig object — two spreads would silently drop the
    // first one's fields.
    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) {
      generationConfig["temperature"] = req.temperature;
    }
    // A structured-output request becomes a JSON MIME type — Gemini's
    // equivalent of OpenAI's response_format.
    if (req.response_format?.type === "json_object") {
      generationConfig["responseMimeType"] = "application/json";
    }
    const requestBody = {
      contents,
      ...(system !== "" ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(Object.keys(generationConfig).length > 0
        ? { generationConfig }
        : {}),
    };
    let body: string;
    try {
      telemetry.requests += 1;
      const res = await llmFetch(
        `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        const excerpt = (await res.text()).slice(0, 200);
        const err = new Error(
          `Gemini API ${res.status}: ${excerpt.slice(0, 80)}`,
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
      throw err;
    }
    const parsed = JSON.parse(body) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      };
    };
    const parts = parsed.candidates?.[0]?.content?.parts ?? [];
    const content = parts.map((p) => p.text ?? "").join("");
    if (content === "") {
      const err = new Error("Gemini response missing content") as ChatError;
      err.provider = this.name;
      err.body_excerpt = body.slice(0, 200);
      err.telemetry = { ...telemetry };
      throw err;
    }
    telemetry.reasoningTokens = parsed.usageMetadata?.thoughtsTokenCount ?? 0;
    telemetry.durationMs = Date.now() - started;
    return {
      content,
      usage: {
        input: parsed.usageMetadata?.promptTokenCount ?? 0,
        output: parsed.usageMetadata?.candidatesTokenCount ?? 0,
      },
      telemetry,
    };
  }
}
