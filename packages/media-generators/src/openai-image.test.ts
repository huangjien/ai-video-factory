import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAIImageProvider } from "./openai-image.js";

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

// 1x1 red JPEG produced once via a known-good base64 constant.
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDX/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+v//Z";

describe("OpenAIImageProvider — developers.openai.com/api/docs/guides/image-generation", () => {
  let server: Server;
  let baseUrl: string;
  let lastAuth: string | undefined;
  let lastBody: string | undefined;
  let lastPath: string | undefined;
  let statusToSend = 200;
  let responseBody: unknown = {
    created: 1792196781,
    data: [{ b64_json: TINY_JPEG_B64 }],
    output_format: "png",
    quality: "low",
    size: "1024x1024",
  };

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      lastAuth = req.headers["authorization"] as string | undefined;
      lastPath = req.url;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        lastBody = Buffer.concat(chunks).toString("utf8");
        res.statusCode = statusToSend;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(responseBody));
      });
    });
    baseUrl = await listen(server);
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  const okBody = () => ({
    created: 1792196781,
    data: [{ b64_json: TINY_JPEG_B64 }],
  });

  it("uploads all character references in order to the edits endpoint", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    statusToSend = 200;
    responseBody = okBody();
    const provider = new OpenAIImageProvider({ apiBaseUrl: baseUrl });
    await provider.generate({
      prompt: "People in a studio",
      width: 1920,
      height: 1080,
      referenceImages: [
        { base64: TINY_JPEG_B64, contentType: "image/jpeg" },
        { base64: TINY_JPEG_B64, contentType: "image/png" },
      ],
    });
    expect(lastPath).toBe("/images/edits");
    expect(lastBody?.match(/name="image\[\]"/g)).toHaveLength(2);
    expect(lastBody).toMatch(/reference-1\.jpg[\s\S]+reference-2\.png/);
  });

  it("sends Bearer auth to /images/generations with the 2.6 model and png output", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    responseBody = okBody();
    statusToSend = 200;
    const p = new OpenAIImageProvider({ apiBaseUrl: baseUrl });
    const result = await p.generate({
      prompt: "dark tech thumbnail",
      width: 1280,
      height: 720,
    });
    expect(result.contentType).toBe("image/png");
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(lastAuth).toBe("Bearer test-key");
    expect(lastPath).toBe("/images/generations");
    const body = JSON.parse(lastBody ?? "{}");
    expect(body.model).toBe("gpt-image-2.6-flare");
    expect(body.output_format).toBe("png");
    expect(body.quality).toBe("low");
    expect(body.n).toBe(1);
  });

  it("asks for the EXACT composition size on 2.6 — the models take custom dimensions", async () => {
    // GPT-Image-2.6 accepts WIDTHxHEIGHT (multiples of 16, ratio between
    // 1:3 and 3:1, 655,360-8,294,400 px). The 2.5 models only take the
    // recommended set, so the snap below is theirs.
    process.env["OPENAI_API_KEY"] = "test-key";
    const p = new OpenAIImageProvider({ apiBaseUrl: baseUrl });

    await p.generate({ prompt: "landscape", width: 1920, height: 1080 });
    expect(JSON.parse(lastBody ?? "{}").size).toBe("1920x1088");

    await p.generate({ prompt: "square", width: 1024, height: 1024 });
    expect(JSON.parse(lastBody ?? "{}").size).toBe("1024x1024");

    await p.generate({ prompt: "vertical", width: 1080, height: 1920 });
    expect(JSON.parse(lastBody ?? "{}").size).toBe("1088x1920");
  });

  it("falls back to the recommended set when the custom size is out of bounds", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    const p = new OpenAIImageProvider({ apiBaseUrl: baseUrl });

    // 100x100 is below the 655,360-pixel floor.
    await p.generate({ prompt: "tiny", width: 100, height: 100 });
    expect(JSON.parse(lastBody ?? "{}").size).toBe("1024x1024");
  });

  it("snaps width/height to the nearest recommended size on the 2.5 models", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    const p = new OpenAIImageProvider({
      apiBaseUrl: baseUrl,
      defaultModel: "gpt-image-2.5-flare",
    });

    await p.generate({ prompt: "landscape", width: 1920, height: 1080 });
    expect(JSON.parse(lastBody ?? "{}").size).toBe("1536x1024");

    await p.generate({ prompt: "square", width: 1024, height: 1024 });
    expect(JSON.parse(lastBody ?? "{}").size).toBe("1024x1024");

    await p.generate({ prompt: "vertical", width: 720, height: 1280 });
    expect(JSON.parse(lastBody ?? "{}").size).toBe("1024x1536");
  });

  it("honors an explicit model and quality", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    const p = new OpenAIImageProvider({
      apiBaseUrl: baseUrl,
      defaultModel: "gpt-image-2.5-sunburst",
      quality: "high",
    });
    await p.generate({ prompt: "x", width: 1024, height: 1024 });
    const body = JSON.parse(lastBody ?? "{}");
    expect(body.model).toBe("gpt-image-2.5-sunburst");
    expect(body.quality).toBe("high");
  });

  it("throws with provider name and status on 401", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    statusToSend = 401;
    responseBody = { error: { message: "Incorrect API key provided" } };
    const p = new OpenAIImageProvider({
      apiBaseUrl: baseUrl,
      retrySleeps: [1, 1, 1],
    });
    await expect(
      p.generate({ prompt: "x", width: 1024, height: 1024 }),
    ).rejects.toMatchObject({ provider: "openai-image", status: 401 });
    statusToSend = 200;
  });

  it("does not retry a 4xx (401 makes exactly one request)", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    statusToSend = 400;
    responseBody = { error: { message: "bad request" } };
    let calls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      calls++;
      return origFetch(...args);
    }) as typeof fetch;
    try {
      const p = new OpenAIImageProvider({
        apiBaseUrl: baseUrl,
        retrySleeps: [1, 1, 1],
      });
      await expect(
        p.generate({ prompt: "x", width: 1024, height: 1024 }),
      ).rejects.toThrow(/OpenAI image API 400/);
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
      statusToSend = 200;
    }
  });

  it("throws explicit message when OPENAI_API_KEY is missing", async () => {
    delete process.env["OPENAI_API_KEY"];
    const p = new OpenAIImageProvider({ apiBaseUrl: baseUrl });
    await expect(
      p.generate({ prompt: "x", width: 1024, height: 1024 }),
    ).rejects.toThrow(/OPENAI_API_KEY not set/);
    process.env["OPENAI_API_KEY"] = "test-key";
  });

  it("does not include the key in error messages", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    statusToSend = 500;
    responseBody = { error: { message: "internal error" } };
    const p = new OpenAIImageProvider({
      apiBaseUrl: baseUrl,
      retrySleeps: [1, 1, 1],
    });
    const err = await p
      .generate({ prompt: "x", width: 1024, height: 1024 })
      .catch((e) => e);
    expect(String(err).includes("test-key")).toBe(false);
    statusToSend = 200;
  });

  it("fails with a clear message when no image is returned", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    responseBody = { created: 1, data: [] };
    const p = new OpenAIImageProvider({ apiBaseUrl: baseUrl });
    await expect(
      p.generate({ prompt: "blocked", width: 1024, height: 1024 }),
    ).rejects.toThrow(/no image in response/i);
    responseBody = okBody();
  });
});
