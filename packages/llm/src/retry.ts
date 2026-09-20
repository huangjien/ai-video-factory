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
