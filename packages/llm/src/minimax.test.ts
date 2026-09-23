import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { MiniMaxProvider } from "./minimax.js";

const baseReq = { messages: [{ role: "user" as const, content: "hi" }] };

function listen(server: Server): Promise<{ url: string; port: number }> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${addr.port}`, port: addr.port });
    });
  });
}

describe("MiniMaxProvider (todo 2) — platform.minimax.io docs", () => {
  let server: Server;
  let baseUrl: string;
  let lastBody: string | undefined;
  let lastAuth: string | undefined;
  let statusToSend = 200;
  let responseBody: unknown = {
    id: "x",
    choices: [
      { message: { content: "hello" }, index: 0, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 7 },
  };

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      lastAuth = req.headers["authorization"] as string | undefined;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        lastBody = Buffer.concat(chunks).toString("utf8");
        res.statusCode = statusToSend;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(responseBody));
      });
    });
    const l = await listen(server);
    baseUrl = l.url;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("sends Bearer auth and parses MiniMax response", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    const p = new MiniMaxProvider({ apiHost: baseUrl });
    const r = await p.chat({ ...baseReq, model: "MiniMax-M3" });
    expect(r.content).toBe("hello");
    expect(r.usage).toEqual({ input: 12, output: 7 });
    expect(lastAuth).toBe("Bearer test-key");
    const body = JSON.parse(lastBody ?? "{}");
    expect(body.model).toBe("MiniMax-M3");
    expect(body.messages[0].content).toBe("hi");
  });

  it("throws ChatError with provider=name on 401", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    statusToSend = 401;
    responseBody = { error: "unauthorized" };
    const p = new MiniMaxProvider({ apiHost: baseUrl });
    await expect(p.chat(baseReq)).rejects.toMatchObject({
      provider: "minimax",
      status: 401,
    });
    statusToSend = 200;
  });

  it("throws explicit message when MINIMAX_API_KEY is missing", async () => {
    delete process.env["MINIMAX_API_KEY"];
    const p = new MiniMaxProvider({ apiHost: baseUrl });
    await expect(p.chat(baseReq)).rejects.toThrow(/MINIMAX_API_KEY not set/);
    process.env["MINIMAX_API_KEY"] = "test-key";
  });

  it("includes body excerpt in error without leaking the key", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    statusToSend = 500;
    responseBody = { error: "boom" };
    const p = new MiniMaxProvider({ apiHost: baseUrl });
    const err = await p.chat(baseReq).catch((e) => e);
    expect(String(err).includes("test-key")).toBe(false);
    expect(err.body_excerpt).toContain("boom");
    statusToSend = 200;
    responseBody = {
      id: "x",
      choices: [
        { message: { content: "hello" }, index: 0, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    };
  });

it("default model is MiniMax-M3 when not specified", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    const p = new MiniMaxProvider({ apiHost: baseUrl });
    await p.chat(baseReq);
    const body = JSON.parse(lastBody ?? "{}");
    expect(body.model).toBe("MiniMax-M3");
  });
});
