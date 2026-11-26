/**
 * Shared HTTP for the picture sources.
 *
 * Wikimedia asks every client to identify itself (their bot policy), and a
 * fetch that hangs must not hold the make pipeline hostage — every source
 * has a short deadline and a byte cap.
 */

/** Descriptive User-Agent — Wikimedia's policy requires one. */
export const USER_AGENT =
  "ai-video-factory/0.11 (video pipeline; https://github.com/ai-video-factory)";

export const DEFAULT_TIMEOUT_MS = 15_000;

/** Fetch JSON with a deadline. Throws on a non-2xx, a timeout, or a parse
 *  error — callers treat every throw as "this source is out". */
export async function fetchJson(
  url: string,
  opts: { timeoutMs?: number; signal?: AbortSignal | undefined } = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${shortUrl(url)}`);
    }
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url.slice(0, 80);
  }
}

/** Strip the HTML that Wikimedia's `extmetadata` values carry, and decode
 *  the handful of entities that survive tag removal. */
export function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Build a query string, dropping empty values. */
export function qs(
  params: Record<string, string | number | undefined>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
  }
  return parts.join("&");
}
