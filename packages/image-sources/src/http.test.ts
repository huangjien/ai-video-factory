import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TIMEOUT_MS,
  USER_AGENT,
  fetchJson,
  qs,
  stripHtml,
} from "./http.js";
import { defaultPictureSources } from "./sources.js";

/** What the stubbed fetch may answer with. */
interface FakeResponse {
  ok?: boolean;
  status?: number;
  json?: unknown;
}

/** The network is the boundary under test: the stub records the request
 *  and answers with whatever the case needs. */
const fetchMock = vi.hoisted(() => vi.fn());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  fetchMock.mockReset();
});

function stubFetch(
  handler: (url: string, init: RequestInit) => FakeResponse | Error,
): void {
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const body = handler(url, init);
    if (body instanceof Error) throw body;
    return {
      ok: body.ok ?? true,
      status: body.status ?? 200,
      json: async () => body.json ?? body,
    };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

/** A fetch that never answers until its signal aborts. */
function hangingFetch(): (
  url: string,
  init: RequestInit,
) => FakeResponse | Error {
  return (_url, init) => {
    // Promise.withResolvers would read better, but this package's TS lib
    // target predates es2024 — the same constraint the CLI package notes.
    const { promise, reject } = (() => {
      let settle!: (reason: unknown) => void;
      const p = new Promise<never>((_resolve, rejectFn) => {
        settle = rejectFn;
      });
      return { promise: p, reject: settle };
    })();
    const signal = init.signal as AbortSignal | undefined;
    signal?.addEventListener("abort", () => reject(new Error("aborted")));
    return promise as unknown as FakeResponse;
  };
}

describe("fetchJson", () => {
  it("returns the parsed body and identifies itself to Wikimedia", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    stubFetch((url, init) => {
      seen = { url, init };
      return { json: { query: { pages: [] } } };
    });
    const out = await fetchJson("https://commons.wikimedia.org/w/api.php?x=1");
    expect(out).toEqual({ query: { pages: [] } });
    expect(seen?.url).toContain("commons.wikimedia.org");
    const headers = (seen?.init.headers ?? {}) as Record<string, string>;
    expect(headers["User-Agent"]).toBe(USER_AGENT);
    expect(headers["Accept"]).toBe("application/json");
  });

  it("throws on a non-2xx, naming the host and path but not the query", async () => {
    stubFetch(() => ({ ok: false, status: 429 }));
    await expect(
      fetchJson("https://commons.wikimedia.org/w/api.php?secret=1"),
    ).rejects.toThrow("HTTP 429 for commons.wikimedia.org/w/api.php");
  });

  it("gives up on its own deadline instead of hanging the pipeline", async () => {
    stubFetch(hangingFetch());
    await expect(
      fetchJson("https://example.org/slow", { timeoutMs: 30 }),
    ).rejects.toThrow();
  });

  it("stops when the caller's own signal aborts", async () => {
    stubFetch(hangingFetch());
    const controller = new AbortController();
    const pending = fetchJson("https://example.org/x", {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it("has a deadline short enough for a make run", () => {
    expect(DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("stripHtml", () => {
  it("drops tags, decodes the entities Wikimedia keeps, and collapses space", () => {
    expect(
      stripHtml(
        '<a href="x">Oil painting</a>, <i>oil on canvas</i>&nbsp;&amp; more&nbsp;&#39;quoted&#39;',
      ),
    ).toBe("Oil painting , oil on canvas & more 'quoted'");
  });

  it("keeps text that has no markup", () => {
    expect(stripHtml("  plain   text  ")).toBe("plain text");
  });

  it("decodes the angle-bracket entities it strips tags around", () => {
    expect(stripHtml("&lt;b&gt;bold&lt;/b&gt;")).toBe("<b>bold</b>");
  });
});

describe("qs", () => {
  it("keeps the values it is given and drops the empty ones", () => {
    expect(
      qs({
        action: "query",
        format: "json",
        page: "",
        limit: 5,
        extra: undefined,
      }),
    ).toBe("action=query&format=json&limit=5");
  });

  it("encodes keys and values", () => {
    expect(qs({ "a b": "c&d" })).toBe("a%20b=c%26d");
  });

  it("returns an empty string when nothing survives", () => {
    expect(qs({ a: undefined, b: "" })).toBe("");
  });
});

describe("defaultPictureSources", () => {
  it("consults the sources in the documented order", () => {
    const sources = defaultPictureSources({
      projectRoot: "/tmp/p",
      workspaceRoot: null,
    });
    expect(sources.map((s) => s.name)).toEqual([
      "commons",
      "wikipedia",
      "met",
      "smithsonian",
      "openverse",
      "artifact",
    ]);
  });

  it("hands the Wikipedia source the requested language", () => {
    const sources = defaultPictureSources({
      projectRoot: "/tmp/p",
      workspaceRoot: null,
      lang: "zh",
    });
    const wikipedia = sources.find((s) => s.name === "wikipedia");
    expect(wikipedia).toBeDefined();
    // The language decides the API host the source will ask.
    expect(JSON.stringify(wikipedia)).toContain("zh.wikipedia.org");
  });
});
