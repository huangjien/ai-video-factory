import type { ChatResponse, Usage } from "./provider.js";

/**
 * Streaming chat, for requests the server would otherwise buffer.
 *
 * A non-streaming chat/completions call sends its RESPONSE HEADERS only
 * after the whole completion is generated. On a long draft (10 sections,
 * a 180–300 s target, per-scene visual lines) that is minutes — and
 * undici's own `headersTimeout` (300 s by default) gives up first,
 * aborting a request that was never going to fail. `AbortSignal.timeout`
 * does not help: it bounds the whole request, while the headers timeout
 * fires earlier and independently.
 *
 * With `"stream": true` the server sends headers immediately and the
 * tokens follow, so the same request completes without a headers race.
 * The chunks are reassembled here into the same ChatResponse shape the
 * rest of the pipeline expects.
 */

/** True for the failure that streaming exists to avoid: the server never
 *  got round to sending response headers. */
export function isHeadersTimeout(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === "UND_ERR_HEADERS_TIMEOUT") return true;
  const cause = e.cause as { code?: unknown; message?: unknown } | undefined;
  if (cause?.code === "UND_ERR_HEADERS_TIMEOUT") return true;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (msg.includes("headers timeout")) return true;
  const causeMsg =
    typeof cause?.message === "string" ? cause.message.toLowerCase() : "";
  return causeMsg.includes("headers timeout");
}

/** Pull the text out of one SSE `data:` payload, or null when the chunk
 *  carries no content (usage-only or keep-alive chunks). */
function contentFromChunk(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const delta = (choices[0] as { delta?: unknown }).delta;
  if (typeof delta !== "object" || delta === null) return null;
  const content = (delta as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function usageFromChunk(payload: unknown): Usage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return null;
  const u = usage as { prompt_tokens?: unknown; completion_tokens?: unknown };
  const input = typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
  const output =
    typeof u.completion_tokens === "number" ? u.completion_tokens : 0;
  return { input, output };
}

export async function chatStream(opts: {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  timeoutMs: number;
}): Promise<ChatResponse> {
  const res = await fetch(opts.url, {
    method: "POST",
    headers: { ...opts.headers, Accept: "text/event-stream" },
    body: JSON.stringify({ ...opts.body, stream: true }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (!res.ok) {
    const excerpt = (await res.text()).slice(0, 200);
    const err = new Error(`stream API ${res.status}: ${excerpt.slice(0, 80)}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  if (res.body === null) {
    throw new Error("stream response had no body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage: Usage = { input: 0, output: 0 };

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    // SSE frames are separated by a blank line; a `data:` line may itself
    // be split across network chunks, so keep the remainder in `buffer`.
    let sep = buffer.indexOf("\n");
    while (sep !== -1) {
      const line = buffer.slice(0, sep).trim();
      buffer = buffer.slice(sep + 1);
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const payload: unknown = JSON.parse(data);
          const text = contentFromChunk(payload);
          if (text !== null) content += text;
          const u = usageFromChunk(payload);
          if (u !== null) usage = u;
        } catch {
          // A malformed frame must not sink the whole response.
        }
      }
      sep = buffer.indexOf("\n");
    }
  }

  return { content, usage };
}

/**
 * Strip a reasoning model's thinking from a response, leaving the answer.
 *
 * A reasoning-enabled model emits `<think>…</think>` BEFORE its answer,
 * and that thinking often contains a JSON/YAML *sketch* — a partial
 * object with `...` placeholders. A parser that takes the first balanced
 * object, or the first fenced block, therefore reads the SKETCH instead
 * of the answer: the sketch parses, or fails to parse, for reasons that
 * have nothing to do with what the model actually said.
 *
 * An unterminated `<think>` (a budget-truncated response) means
 * everything after it is still reasoning, so the whole remainder is
 * dropped.
 */
export function stripReasoning(content: string): string {
  let out = content;
  const lastOpen = out.lastIndexOf("<think>");
  if (lastOpen !== -1) {
    const close = out.indexOf("</think>", lastOpen);
    out = close === -1 ? "" : out.slice(close + "</think>".length);
  }
  return out.replace(/<\/?think>/g, "");
}
