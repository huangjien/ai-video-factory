import { Agent } from "undici";

/**
 * Long-duration LLM requests (e.g. `vf draft --duration 600` produces
 * ~19k output tokens) can take over 5 minutes before the server sends
 * response headers. Node's global fetch (undici) defaults to a
 * 300-second headersTimeout, which aborts those requests with
 * `UND_ERR_HEADERS_TIMEOUT`. This shared Agent raises both the
 * headers and body timeout to 15 minutes to accommodate slow
 * long-form completions.
 */
export const longTimeoutAgent = new Agent({
  headersTimeout: 900_000,
  bodyTimeout: 900_000,
});
