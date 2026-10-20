/**
 * Long-duration LLM requests (e.g. `video draft --duration 600` produces
 * ~19k output tokens) can take over 5 minutes before the server sends
 * response headers. Node's global fetch defaults to a 300-second
 * headersTimeout, which aborts those requests with
 * `UND_ERR_HEADERS_TIMEOUT`.
 *
 * We use the built-in `AbortSignal.timeout(ms)` instead of a custom
 * undici Agent. Earlier versions of this file exported an
 * `Agent({ headersTimeout, bodyTimeout })` and passed it as
 * `dispatcher` to global fetch — that worked on Node 18/20 but
 * breaks on Node 22+ because the global fetch rejects third-party
 * undici Agent instances with `UND_ERR_INVALID_ARG` during the
 * `assertRequestHandler` check. `AbortSignal.timeout` is portable
 * across Node versions and avoids the undici version coupling.
 *
 * The 300 s undici headersTimeout is a SEPARATE limit that
 * AbortSignal cannot raise — a request whose response headers are
 * delayed past it dies with UND_ERR_HEADERS_TIMEOUT no matter how
 * long this signal allows. That is why the providers fall back to a
 * STREAMED request (packages/llm/src/stream.ts) on that failure:
 * a stream sends headers immediately and the tokens follow.
 *
 * This ceiling must also exceed the time a full generation takes —
 * a long `video draft` runs tens of thousands of output tokens, and
 * hitting this limit TRUNCATES the response mid-JSON rather than
 * failing cleanly.
 */
export const LLM_TIMEOUT_MS = 2_400_000; // 40 minutes
