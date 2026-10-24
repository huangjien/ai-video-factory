/**
 * Transient stream-noise guard (2026-10-24): long LLM calls over undici's
 * http2 can emit a stray fatal `error` event when the connection resets —
 * the process dies even though the fetch promise's rejection is already
 * flowing into the bounded retry (`withRetry` + `isTransientError` in
 * @video/llm), and a wasted paid run is the result. The guard absorbs ONLY
 * this noise class; genuine bugs still exit loudly.
 */

function codeOf(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { code?: unknown; cause?: unknown };
  if (typeof e.code === "string") return e.code;
  return codeOf(e.cause);
}

/** True when a rejection/error is undici stream teardown noise that a
 * bounded retry elsewhere will handle. Deliberately narrow. */
export function isTransientStreamNoise(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false;
  const e = reason as Error;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  const streamTeardown =
    msg.includes("terminated") ||
    msg.includes("socket hang up") ||
    codeOf(reason) === "ERR_HTTP2_STREAM_ERROR";
  const reset = codeOf(reason) === "ECONNRESET";
  // A real programming bug names the operation that failed; stream noise
  // is always about the connection itself.
  const looksLikeBug =
    msg.includes("cannot read properties") ||
    msg.includes("is not a function") ||
    msg.includes("is not defined");
  return (streamTeardown || reset) && !looksLikeBug;
}

/** Install the process-level guard. Idempotent. */
export function installStreamGuard(): void {
  const g = process as NodeJS.Process & { __streamGuardInstalled?: boolean };
  if (g.__streamGuardInstalled) return;
  g.__streamGuardInstalled = true;
  process.on("unhandledRejection", (reason) => {
    if (isTransientStreamNoise(reason)) {
      console.error(
        `warning: transient stream error absorbed (bounded retry handles it) — ${
          (reason as Error)?.message ?? reason
        }`,
      );
      return;
    }
    // Re-throw: real bugs must crash loudly, not vanish into a log line.
    throw reason;
  });
}
