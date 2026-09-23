import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { GLMProvider } from "./glm.js";

const baseReq = { messages: [{ role: "user" as const, content: "hi" }] };

function listen(server: Server): Promise<{ url: string; port: number }> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${addr.port}`, port: addr.port });
    });
  });
}

describe("GLMProvider (todo 3) — docs.z.ai/devpack", () => {
  let server: Server;
  let baseUrl: string;
  let lastAuth: string | undefined;
  let statusToSend = 200;
  let responseBody: unknown = {
    choices: [
      { message: { content: "ok-glm" }, index: 0, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 30, completion_tokens: 18 },
  };

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      lastAuth = req.headers["authorization"] as string | undefined;
      res.statusCode = statusToSend;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(responseBody));
    });
    const l = await listen(server);
    baseUrl = l.url;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("sends Bearer auth and parses GLM OpenAI-compatible response", async () => {
    process.env["GLM_API_KEY"] = "glm-test-key";
    const p = new GLMProvider({ baseUrl });
    const r = await p.chat({ ...baseReq, model: "glm-4.6" });
    expect(r.content).toBe("ok-glm");
    expect(r.usage).toEqual({ input: 30, output: 18 });
    expect(lastAuth).toBe("Bearer glm-test-key");
  });

  it("default model is glm-4.6", async () => {
    process.env["GLM_API_KEY"] = "glm-test-key";
    const p = new GLMProvider({ baseUrl });
    await p.chat(baseReq);
    expect(p["defaultModel"]).toBe("glm-4.6");
  });

  it("throws ChatError with provider=glm on 401", async () => {
    process.env["GLM_API_KEY"] = "glm-test-key";
    statusToSend = 401;
    responseBody = { error: "unauthorized" };
    const p = new GLMProvider({ baseUrl });
    await expect(p.chat(baseReq)).rejects.toMatchObject({
      provider: "glm",
      status: 401,
    });
    statusToSend = 200;
    responseBody = {
      choices: [
        { message: { content: "ok-glm" }, index: 0, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 30, completion_tokens: 18 },
    };
  });

  it("throws explicit message when GLM_API_KEY is missing", async () => {
    delete process.env["GLM_API_KEY"];
    const p = new GLMProvider({ baseUrl });
    await expect(p.chat(baseReq)).rejects.toThrow(/GLM_API_KEY not set/);
    process.env["GLM_API_KEY"] = "glm-test-key";
  });

  it("does not include the key in error messages", async () => {
    process.env["GLM_API_KEY"] = "glm-test-key";
    statusToSend = 500;
    responseBody = { error: "glmfail" };
    const p = new GLMProvider({ baseUrl });
    const err = await p.chat(baseReq).catch((e) => e);
    expect(String(err).includes("glm-test-key")).toBe(false);
    expect(err.body_excerpt).toContain("glmfail");
    statusToSend = 200;
    responseBody = {
      choices: [
        { message: { content: "ok-glm" }, index: 0, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 30, completion_tokens: 18 },
    };
  });
});
