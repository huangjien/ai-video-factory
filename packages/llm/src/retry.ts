/** Bounded retry policy per doc §62.1:
 * validation failures are NEVER retried; transient (network / 5xx / timeouts)
 * up to 3 attempts with backoff. The `isRetriable` predicate defaults to
 * "retry anything" — callers must opt OUT (e.g. 4xx). Exhaustion rethrows
 * the last error so callers see the underlying cause.
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

/** An error that indicates the primary provider is exhausted / quotaed
 * out, so we should switch to the fallback provider rather than retry. */
function isQuotaError(err: unknown): boolean {
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
    msg.includes("rate limit")
  ) {
    return true;
  }
  return false;
}

/** Try `primary.chat(req)`; if it errors with a quota/rate-limit signal,
 * fall back to `fallback.chat(req)`. The returned object carries the name
 * of the provider that actually served the request so callers can log it.
 *
 * Only retries on the primary. If the fallback also fails, its error
 * propagates. Non-quota errors (e.g. 400 invalid input) on the primary
 * surface immediately — they are not "use up quota, switch provider"
 * signals. */
export async function chatWithFallback(
  primary: import("./provider.js").Provider,
  fallback: import("./provider.js").Provider | null,
  req: import("./provider.js").ChatRequest,
): Promise<{ provider: string; response: import("./provider.js").ChatResponse }> {
  try {
    const response = await primary.chat(req);
    return { provider: primary.name, response };
  } catch (err) {
    if (!fallback || !isQuotaError(err)) throw err;
    const response = await fallback.chat(req);
    return { provider: fallback.name, response };
  }
}
