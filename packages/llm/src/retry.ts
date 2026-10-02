/** Bounded retry policy per doc §62.1:
 * validation failures are NEVER retried; transient (network / 5xx / timeouts)
 * up to 3 attempts with backoff. The `isRetriable` predicate defaults to
 * "retry anything" — callers must opt OUT (e.g. 4xx). Exhaustion rethrows
 * the last error so callers see the underlying cause.
 *
 * `chatWithFallback` layers provider failover on top: the PRIMARY call gets
 * the bounded transient retry; once exhausted, fallback-eligible errors
 * (quota / rate-limit / missing API key / transient exhaustion) trigger ONE
 * attempt on the fallback provider, which receives the request WITHOUT the
 * `model` field so it uses its own default model. Non-eligible errors
 * (e.g. 400) surface immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    sleeps?: number[] | undefined;
    isRetriable?: ((err: unknown) => boolean) | undefined;
  } = {},
): Promise<T> {
  const sleeps = opts.sleeps ?? [1000, 2000, 4000];
  const isRetriable = opts.isRetriable ?? (() => true);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= sleeps.length; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetriable(err)) throw err;
      if (attempt === sleeps.length) break;
      const ms = sleeps[attempt];
      if (ms === undefined) break;
      await new Promise((r) => setTimeout(r, ms));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** True for transient failures a bounded retry can fix: network errors,
 * HTTP 5xx, and timeout/abort errors. 4xx client errors are NEVER
 * transient (a 400 will not get better by trying again). */
export function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; name?: unknown; message?: unknown };
  if (typeof e.status === "number") return e.status >= 500;
  const name = typeof e.name === "string" ? e.name.toLowerCase() : "";
  if (name === "aborterror" || name === "timeouterror") return true;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return (
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("timeout") ||
    msg.includes("abort")
  );
}

/** True when the primary provider cannot serve the request at all and the
 * fallback should get a shot: quota / rate-limit / balance exhaustion,
 * a missing API key on the primary, or transient errors after the retry
 * budget is exhausted. 4xx client errors (e.g. 400 invalid input) are NOT
 * fallback-eligible — they surface immediately. */
export function isFallbackEligible(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; provider?: unknown; message?: unknown };
  if (typeof e.status === "number") {
    if (e.status === 429 || e.status === 402 || e.status === 403) {
      return true;
    }
  }
  const body = (e as { body_excerpt?: unknown }).body_excerpt;
  if (typeof body === "string") {
    const lower = body.toLowerCase();
    if (
      lower.includes("insufficient") ||
      lower.includes("quota") ||
      lower.includes("balance") ||
      lower.includes("rate_limit") ||
      lower.includes("rate limit") ||
      lower.includes("exhausted")
    ) {
      return true;
    }
  }
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (
    msg.includes("insufficient") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    // Providers throw Error("<NAME>_API_KEY not set in environment")
    // with no status when the key is missing — the fallback may have one.
    msg.includes("api_key not set")
  ) {
    return true;
  }
  return isTransientError(err);
}

/** Try `primary.chat(req)` with a bounded transient retry (network / 5xx /
 * timeout — never 4xx), then consult the fallback ONCE for fallback-eligible
 * errors (quota / rate-limit / missing API key / exhausted transients).
 * The returned object carries the name of the provider that actually served
 * the request so callers can log it.
 *
 * The fallback receives the request WITHOUT the `model` field so it uses
 * its own provider default — a primary-specific model id (e.g.
 * "MiniMax-M3") would be rejected as unknown by the fallback provider.
 * If the fallback also fails, its error propagates. Non-eligible errors
 * (e.g. 400 invalid input) on the primary surface immediately. */
export async function chatWithFallback(
  primary: import("./provider.js").Provider,
  fallback: import("./provider.js").Provider | null,
  req: import("./provider.js").ChatRequest,
  opts: { sleeps?: number[] | undefined } = {},
): Promise<{ provider: string; response: import("./provider.js").ChatResponse }> {
  try {
    const response = await withRetry(() => primary.chat(req), {
      sleeps: opts.sleeps,
      isRetriable: isTransientError,
    });
    return { provider: primary.name, response };
  } catch (err) {
    if (!fallback || !isFallbackEligible(err)) throw err;
    // Strip `model`: the fallback must use its own default model.
    const fallbackReq: import("./provider.js").ChatRequest = {
      messages: req.messages,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.response_format ? { response_format: req.response_format } : {}),
    };
    const response = await fallback.chat(fallbackReq);
    return { provider: fallback.name, response };
  }
}
