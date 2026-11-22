import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAIProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";

const baseReq = { messages: [{ role: "user" as const, content: "hi" }] };

function listen(server: Server): Promise<{ url: string; port: number }> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${addr.port}`, port: addr.port });
    });
  });
}

describe("OpenAIProvider — chat/completions", () => {
  let server: Server;
  let baseUrl: string;
  let lastAuth: string | undefined;
  let lastBody: Record<string, unknown> = {};
  let lastPath = "";

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      lastAuth = req.headers["authorization"] as string | undefined;
      lastPath = req.url ?? "";
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        lastBody = raw === "" ? {} : (JSON.parse(raw) as Record<string, unknown>);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            choices: [{ message: { content: "ok-openai" }, index: 0 }],
            usage: {
              prompt_tokens: 21,
              completion_tokens: 9,
              completion_tokens_details: { reasoning_tokens: 4 },
            },
          }),
        );
      });
    });
    const l = await listen(server);
    baseUrl = l.url;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("sends Bearer auth and parses the OpenAI-shaped response", async () => {
    process.env["OPENAI_API_KEY"] = "openai-test-key";
    const p = new OpenAIProvider({ baseUrl });
    const r = await p.chat(baseReq);
    expect(r.content).toBe("ok-openai");
    expect(r.usage).toEqual({ input: 21, output: 9 });
    expect(r.telemetry?.reasoningTokens).toBe(4);
    expect(lastAuth).toBe("Bearer openai-test-key");
    expect(lastPath).toBe("/chat/completions");
  });

  it("defaults to gpt-6.1-sol and honours an explicit model", async () => {
    process.env["OPENAI_API_KEY"] = "openai-test-key";
    await new OpenAIProvider({ baseUrl }).chat(baseReq);
    expect(lastBody["model"]).toBe("gpt-6.1-sol");
    await new OpenAIProvider({ baseUrl }).chat({ ...baseReq, model: "gpt-5.2" });
    expect(lastBody["model"]).toBe("gpt-5.2");
  });

  it("passes response_format through and never sends a thinking field", async () => {
    process.env["OPENAI_API_KEY"] = "openai-test-key";
    await new OpenAIProvider({ baseUrl }).chat({
      ...baseReq,
      response_format: { type: "json_object" },
      thinking: "disabled",
    });
    expect(lastBody["response_format"]).toEqual({ type: "json_object" });
    expect("thinking" in lastBody).toBe(false);
  });

  it("fails loudly without an API key", async () => {
    delete process.env["OPENAI_API_KEY"];
    const p = new OpenAIProvider({ baseUrl });
    await expect(p.chat(baseReq)).rejects.toThrow(/OPENAI_API_KEY/);
  });
});

describe("GeminiProvider — generateContent", () => {
  let server: Server;
  let baseUrl: string;
  let lastKey: string | undefined;
  let lastPath = "";
  let lastBody: Record<string, unknown> = {};

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      lastKey = req.headers["x-goog-api-key"] as string | undefined;
      lastPath = req.url ?? "";
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        lastBody = raw === "" ? {} : (JSON.parse(raw) as Record<string, unknown>);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "ok-gemini" }] } }],
            usageMetadata: {
              promptTokenCount: 12,
              candidatesTokenCount: 5,
              thoughtsTokenCount: 2,
            },
          }),
        );
      });
    });
    const l = await listen(server);
    baseUrl = l.url;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("maps messages to contents and parses the Gemini response", async () => {
    process.env["GEMINI_API_KEY"] = "gemini-test-key";
    const p = new GeminiProvider({ baseUrl });
    const r = await p.chat({
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });
    expect(r.content).toBe("ok-gemini");
    expect(r.usage).toEqual({ input: 12, output: 5 });
    expect(r.telemetry?.reasoningTokens).toBe(2);
    expect(lastKey).toBe("gemini-test-key");
    expect(lastPath).toContain(":generateContent");
    const contents = lastBody["contents"] as { role: string; parts: { text: string }[] }[];
    expect(contents.map((c) => c.role)).toEqual(["user", "model"]);
    expect(lastBody["systemInstruction"]).toEqual({
      parts: [{ text: "be terse" }],
    });
  });

  it("turns a structured-output request into a JSON MIME type", async () => {
    process.env["GEMINI_API_KEY"] = "gemini-test-key";
    await new GeminiProvider({ baseUrl }).chat({
      ...baseReq,
      response_format: { type: "json_object" },
      temperature: 0.3,
    });
    expect(lastBody["generationConfig"]).toEqual({
      temperature: 0.3,
      responseMimeType: "application/json",
    });
  });

  it("fails loudly without an API key", async () => {
    delete process.env["GEMINI_API_KEY"];
    const p = new GeminiProvider({ baseUrl });
    await expect(p.chat(baseReq)).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
