import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { MiniMaxWebSearch } from "./web-search.js";

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

describe("MiniMaxWebSearch (todo 2) — platform.minimax.io docs", () => {
  let server: Server;
  let baseUrl: string;
  let statusToSend = 200;
  let responseBody: unknown = {
    organic: [
      {
        url: "https://example.com/1",
        title: "First",
        snippet: "Snippet one",
      },
      {
        url: "https://example.com/2",
        title: "Second",
        snippet: "Snippet two",
      },
    ],
    related_searches: [],
    base_resp: { status_code: 0, status_msg: "ok" },
  };

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      res.statusCode = statusToSend;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(responseBody));
    });
    baseUrl = await listen(server);
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("returns up to 10 results from the organic array", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    const w = new MiniMaxWebSearch({ apiHost: baseUrl });
    const results = await w.search("AI memory");
    expect(results).toHaveLength(2);
    expect(results[0]?.url).toBe("https://example.com/1");
  });

  it("throws WebSearchError with provider on 401", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    statusToSend = 401;
    responseBody = { error: "unauthorized" };
    const w = new MiniMaxWebSearch({ apiHost: baseUrl });
    await expect(w.search("x")).rejects.toMatchObject({
      provider: "minimax-web",
      status: 401,
    });
    statusToSend = 200;
    responseBody = {
      organic: [{ url: "https://example.com/1", title: "First", snippet: "x" }],
      related_searches: [],
      base_resp: { status_code: 0, status_msg: "ok" },
    };
  });

  it("throws explicit message when MINIMAX_API_KEY is missing", async () => {
    delete process.env["MINIMAX_API_KEY"];
    const w = new MiniMaxWebSearch({ apiHost: baseUrl });
    await expect(w.search("x")).rejects.toThrow(/MINIMAX_API_KEY not set/);
    process.env["MINIMAX_API_KEY"] = "test-key";
  });

  it("does not include the key in error messages", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    statusToSend = 500;
    responseBody = { error: "boom" };
    const w = new MiniMaxWebSearch({ apiHost: baseUrl, retrySleeps: [1, 1, 1] });
    const err = await w.search("x").catch((e) => e);
    expect(String(err).includes("test-key")).toBe(false);
    statusToSend = 200;
    responseBody = {
      organic: [],
      related_searches: [],
      base_resp: { status_code: 0, status_msg: "ok" },
    };
  });

  it("limits results to top 10 even when organic has more", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    responseBody = {
      organic: Array.from({ length: 25 }, (_, i) => ({
        url: `https://example.com/${i}`,
        title: `R${i}`,
        snippet: `S${i}`,
      })),
      related_searches: [],
      base_resp: { status_code: 0, status_msg: "ok" },
    };
    const w = new MiniMaxWebSearch({ apiHost: baseUrl });
    const results = await w.search("x");
    expect(results).toHaveLength(10);
  });
});
