import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { GeminiImageProvider } from "./gemini-image.js";

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

describe("GeminiImageProvider — ai.google.dev/gemini-api/docs/image-generation", () => {
  let server: Server;
  let baseUrl: string;
  let lastApiKeyHeader: string | undefined;
  let lastBody: string | undefined;
  let lastPath: string | undefined;
  let statusToSend = 200;
  let responseBody: unknown = {
    output_image: { data: TINY_JPEG_B64, mime_type: "image/jpeg" },
  };

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      lastApiKeyHeader = req.headers["x-goog-api-key"] as string | undefined;
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

  it("sends x-goog-api-key to /interactions with the nano-banana model", async () => {
    process.env["GEMINI_API_KEY"] = "test-key";
    const p = new GeminiImageProvider({ apiBaseUrl: baseUrl });
    const result = await p.generate({
      prompt: "dark tech thumbnail",
      width: 1280,
      height: 720,
    });
    expect(result.contentType).toBe("image/jpeg");
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(lastApiKeyHeader).toBe("test-key");
    expect(lastPath).toBe("/interactions");
    const body = JSON.parse(lastBody ?? "{}");
    expect(body.model).toBe("gemini-3.1-flash-image");
    expect(body.input).toEqual([{ type: "text", text: "dark tech thumbnail" }]);
    expect(body.response_format.type).toBe("image");
  });

  it("uses snake_case response_format keys and maps the aspect ratio", async () => {
    process.env["GEMINI_API_KEY"] = "test-key";
    const p = new GeminiImageProvider({ apiBaseUrl: baseUrl });

    await p.generate({ prompt: "landscape", width: 1920, height: 1080 });
    let body = JSON.parse(lastBody ?? "{}");
    expect(body.response_format.aspect_ratio).toBe("16:9");
    expect(body.response_format.mime_type).toBe("image/jpeg");
    // camelCase is rejected by the live API — guard against a regression.
    expect(body.response_format.mimeType).toBeUndefined();
    expect(body.response_format.aspectRatio).toBeUndefined();

    await p.generate({ prompt: "square", width: 1024, height: 1024 });
    expect(JSON.parse(lastBody ?? "{}").response_format.aspect_ratio).toBe(
      "1:1",
    );

    await p.generate({ prompt: "vertical", width: 720, height: 1280 });
    expect(JSON.parse(lastBody ?? "{}").response_format.aspect_ratio).toBe(
      "9:16",
    );
  });

  it("throws with provider name and status on 403", async () => {
    process.env["GEMINI_API_KEY"] = "test-key";
    statusToSend = 403;
    responseBody = {
      error: {
        code: 403,
        message: "Permission denied",
        status: "PERMISSION_DENIED",
      },
    };
    const p = new GeminiImageProvider({
      apiBaseUrl: baseUrl,
      retrySleeps: [1, 1, 1],
    });
    await expect(
      p.generate({ prompt: "x", width: 1024, height: 1024 }),
    ).rejects.toMatchObject({ provider: "gemini-image", status: 403 });
    statusToSend = 200;
  });

  it("reads the message out of an array-shaped error body (402 depleted credits)", async () => {
    process.env["GEMINI_API_KEY"] = "test-key";
    statusToSend = 402;
    // Shape observed against the live API.
    responseBody = [
      {
        error: {
          code: 402,
          message: "Your prepayment credits are depleted.",
          status: "RESOURCE_EXHAUSTED",
        },
      },
    ];
    const p = new GeminiImageProvider({
      apiBaseUrl: baseUrl,
      retrySleeps: [1, 1, 1],
    });
    await expect(
      p.generate({ prompt: "x", width: 1024, height: 1024 }),
    ).rejects.toThrow(/prepayment credits are depleted/i);
    statusToSend = 200;
  });

  it("throws explicit message when GEMINI_API_KEY is missing", async () => {
    delete process.env["GEMINI_API_KEY"];
    const p = new GeminiImageProvider({ apiBaseUrl: baseUrl });
    await expect(
      p.generate({ prompt: "x", width: 1024, height: 1024 }),
    ).rejects.toThrow(/GEMINI_API_KEY not set/);
    process.env["GEMINI_API_KEY"] = "test-key";
  });

  it("does not include the key in error messages", async () => {
    process.env["GEMINI_API_KEY"] = "test-key";
    statusToSend = 500;
    responseBody = { error: { message: "internal error" } };
    const p = new GeminiImageProvider({
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
    process.env["GEMINI_API_KEY"] = "test-key";
    responseBody = { output_image: null };
    const p = new GeminiImageProvider({ apiBaseUrl: baseUrl });
    await expect(
      p.generate({ prompt: "blocked", width: 1024, height: 1024 }),
    ).rejects.toThrow(/no image in response/i);
    responseBody = { output_image: { data: TINY_JPEG_B64 } };
  });
});
