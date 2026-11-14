import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
  type Response as UndiciResponse,
} from "undici";
import { LLM_TIMEOUT_MS } from "./timeout.js";

/**
 * The HTTP client every provider call goes through.
 *
 * WHY THIS EXISTS — a 300-second tax that used to be paid twice per
 * long call:
 *
 * A non-streaming chat completion sends its RESPONSE HEADERS only after
 * the whole completion is generated. Node's global fetch runs on the
 * BUNDLED undici, whose Agent defaults are `headersTimeout: 300_000`
 * and `bodyTimeout: 300_000` — so any generation slower than five
 * minutes dies with UND_ERR_HEADERS_TIMEOUT, the tokens are lost, and
 * the request has to be issued AGAIN. `AbortSignal.timeout` cannot
 * raise that ceiling: it bounds the whole request, not the header wait.
 *
 * The 2026-11-13 article draft paid that tax on every judge call —
 * measured 300.1 s discarded before the re-issued stream produced the
 * same answer in 223 s (a 523.5 s call for a scorecard).
 *
 * The history here is why the fix is subtle:
 *   - 7d1aec5 (2026-09-25) raised the ceiling to 900 s through a
 *     custom undici Agent.
 *   - f618cdf (2026-09-27) replaced that Agent with `AbortSignal` to
 *     dodge a Node-22 incompatibility (`UND_ERR_INVALID_ARG`) and
 *     SILENTLY dropped the ceiling back to 300 s.
 *
 * The incompatibility f618cdf hit is real but avoidable: Node's global
 * fetch rejects a dispatcher that comes from a DIFFERENT undici copy
 * than its own. Here both come from the same one — the standalone
 * `undici` package, a direct dependency of this package — so its fetch
 * accepts its own Agent and the ceiling can be raised for real.
 *
 * The streaming path stays as the safety net (see packages/llm/src/
 * stream.ts): if a provider ever refuses to answer within this ceiling,
 * the request is re-issued as a stream, whose headers arrive at once.
 */
let sharedAgent: Agent | null = null;

/** The ceiling on the header wait and the body read.
 *
 * Default: the LLM ceiling (40 min) — a long draft must not die halfway.
 * `LLM_HTTP_TIMEOUT_MS` lowers it (milliseconds) for an operator who
 * wants a shorter wait; it is also what the test uses to prove the
 * pool's timeout is really in force. */
export function llmHttpTimeouts(): {
  headersTimeout: number;
  bodyTimeout: number;
} {
  const raw = process.env["LLM_HTTP_TIMEOUT_MS"];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  const ms =
    Number.isFinite(parsed) && parsed > 0 ? parsed : LLM_TIMEOUT_MS;
  return { headersTimeout: ms, bodyTimeout: ms };
}

/** One connection pool for every provider call. `keepAliveTimeout` is
 *  kept short so the CLI can exit promptly — an idle pooled socket
 *  otherwise holds the event loop open. */
function agent(): Agent {
  if (sharedAgent === null) {
    const { headersTimeout, bodyTimeout } = llmHttpTimeouts();
    sharedAgent = new Agent({
      headersTimeout,
      bodyTimeout,
      keepAliveTimeout: 1_000,
    });
  }
  return sharedAgent;
}

/** `fetch` with the LLM ceiling on the header wait and the body read.
 *  Same contract as the global `fetch` for the callers in this
 *  package; the difference is the timeout, not the semantics. */
export async function llmFetch(
  url: string,
  init: UndiciRequestInit,
): Promise<UndiciResponse> {
  return undiciFetch(url, { ...init, dispatcher: agent() });
}

/** Close the shared pool. Called by the CLI on the way out so a pooled
 *  socket cannot delay process exit; harmless to call more than once. */
export async function closeLlmHttp(): Promise<void> {
  if (sharedAgent === null) return;
  const closing = sharedAgent;
  sharedAgent = null;
  await closing.close();
}
