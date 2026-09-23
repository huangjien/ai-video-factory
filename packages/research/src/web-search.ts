import { withRetry } from "@vf/llm";
import type { WebSearchResult } from "./schemas.js";

export interface MiniMaxWebSearchOptions {
  apiHost?: string | undefined;
  defaultLimit?: number | undefined;
  /** Override the default retry sleeps (default: [1000, 2000, 4000]). Tests use [1,1,1]. */
  retrySleeps?: number[] | undefined;
}

export interface WebSearchError extends Error {
  provider: string;
  status?: number | undefined;
  body_excerpt?: string | undefined;
}

/** MiniMax Coding Plan web search (platform.minimax.io context7-verified).
 * POST `${apiHost}/v1/coding_plan/search` with `{q: "..."}`. Bearer `MINIMAX_API_KEY`.
 * Response shape: `{organic: [{url,title,snippet}], related_searches: [...], base_resp: {...}}`.
 * Never persists credentials; bounded retry per §62.1 (no 4xx retry).
 */
export class MiniMaxWebSearch {
  readonly name = "minimax-web";
  private readonly apiHost: string;
  private readonly defaultLimit: number;
  private readonly retrySleeps: number[];

  constructor(opts: MiniMaxWebSearchOptions = {}) {
    this.apiHost =
      opts.apiHost ??
      process.env["MINIMAX_API_HOST"] ??
      "https://api.minimax.io";
    this.defaultLimit = opts.defaultLimit ?? 10;
    this.retrySleeps = opts.retrySleeps ?? [1000, 2000, 4000];
  }

  async search(query: string): Promise<WebSearchResult[]> {
    const key = process.env["MINIMAX_API_KEY"];
    if (!key) {
      const err = new Error(
        "MINIMAX_API_KEY not set in environment",
      ) as WebSearchError;
      err.provider = this.name;
      throw err;
    }
    const data = await withRetry(
      async () => {
        const res = await fetch(`${this.apiHost}/v1/coding_plan/search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({ q: query }),
        });
        const text = await res.text();
        if (!res.ok) {
          const excerpt = text.slice(0, 200);
          const err = new Error(
            `MiniMax web_search ${res.status}: ${excerpt.slice(0, 80)}`,
          ) as WebSearchError;
          err.provider = this.name;
          err.status = res.status;
          err.body_excerpt = excerpt;
          throw err;
        }
        return JSON.parse(text) as {
          organic?: { url: string; title: string; snippet: string }[];
        };
      },
      {
        isRetriable: (err) => !/40[1-9]/.test(String(err)),
        sleeps: this.retrySleeps,
      },
    );
    return (data.organic ?? []).slice(0, this.defaultLimit).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.snippet,
    }));
  }
}
