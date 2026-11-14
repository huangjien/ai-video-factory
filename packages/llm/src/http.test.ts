import { describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { llmFetch, llmHttpTimeouts } from "./http.js";
import { LLM_TIMEOUT_MS } from "./timeout.js";

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

describe("llmHttpTimeouts", () => {
  it("defaults to the LLM ceiling — a long draft must not die halfway", () => {
    delete process.env["LLM_HTTP_TIMEOUT_MS"];
    expect(llmHttpTimeouts()).toEqual({
      headersTimeout: LLM_TIMEOUT_MS,
      bodyTimeout: LLM_TIMEOUT_MS,
    });
  });

  it("honours an explicit override", () => {
    process.env["LLM_HTTP_TIMEOUT_MS"] = "1234";
    try {
      expect(llmHttpTimeouts().headersTimeout).toBe(1234);
    } finally {
      delete process.env["LLM_HTTP_TIMEOUT_MS"];
    }
  });

  it("ignores a nonsense override", () => {
    process.env["LLM_HTTP_TIMEOUT_MS"] = "not-a-number";
    try {
      expect(llmHttpTimeouts().headersTimeout).toBe(LLM_TIMEOUT_MS);
    } finally {
      delete process.env["LLM_HTTP_TIMEOUT_MS"];
    }
  });
});

describe("llmFetch", () => {
  it("applies the pool's header timeout instead of undici's 300 s default", async () => {
    // The whole point of packages/llm/src/http.ts: a non-streaming
    // completion sends its headers only after the whole answer is
    // generated, and undici's default header wait (300 s) throws those
    // tokens away. This test pins the mechanism — with a 300 ms ceiling
    // the request gives up BEFORE the server's headers arrive, which is
    // exactly what the default 300 s ceiling used to do at 300 s.
    process.env["LLM_HTTP_TIMEOUT_MS"] = "300";
    const server = createServer((_req, res) => {
      setTimeout(() => {
        res.statusCode = 200;
        res.end("late");
      }, 1_500);
    });
    const url = await listen(server);
    const started = Date.now();
    try {
      await expect(
        llmFetch(url, { method: "GET" } as never),
      ).rejects.toMatchObject({
        cause: { code: "UND_ERR_HEADERS_TIMEOUT" },
      });
      // It gave up on the header wait, not on the 1.5 s body.
      expect(Date.now() - started).toBeLessThan(1_400);
    } finally {
      delete process.env["LLM_HTTP_TIMEOUT_MS"];
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
