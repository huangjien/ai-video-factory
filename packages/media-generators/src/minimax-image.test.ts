import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { MiniMaxImageProvider } from "./minimax-image.js";

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

describe("MiniMaxImageProvider (v0.3 phase 1) — platform.minimax.io docs", () => {
  let server: Server;
  let baseUrl: string;
  let lastAuth: string | undefined;
  let lastBody: string | undefined;
  let statusToSend = 200;
  let responseBody: unknown = {
    id: "x",
    data: { image_base64: [TINY_JPEG_B64] },
    metadata: { success_count: 1, failed_count: 0 },
    base_resp: { status_code: 0, status_msg: "success" },
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
    baseUrl = await listen(server);
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("sends Bearer auth + model image-01 + base64 format, returns JPEG bytes", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    const p = new MiniMaxImageProvider({ apiHost: baseUrl });
    const result = await p.generate({
      prompt: "dark tech thumbnail",
      width: 1280,
      height: 720,
    });
    expect(result.contentType).toBe("image/jpeg");
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(lastAuth).toBe("Bearer test-key");
    const body = JSON.parse(lastBody ?? "{}");
    expect(body.model).toBe("image-01");
    expect(body.response_format).toBe("base64");
    expect(body.aspect_ratio).toBe("16:9");
  });

  it("maps width/height to the closest supported aspect_ratio", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    const p = new MiniMaxImageProvider({ apiHost: baseUrl });
    await p.generate({ prompt: "square", width: 1024, height: 1024 });
    const body1 = JSON.parse(lastBody ?? "{}");
    expect(body1.aspect_ratio).toBe("1:1");

    await p.generate({ prompt: "vertical", width: 720, height: 1280 });
    const body2 = JSON.parse(lastBody ?? "{}");
    expect(body2.aspect_ratio).toBe("9:16");
  });

  it("throws with provider name on 401", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    statusToSend = 401;
    responseBody = { base_resp: { status_code: 1004, status_msg: "invalid api key" } };
    const p = new MiniMaxImageProvider({ apiHost: baseUrl, retrySleeps: [1, 1, 1] });
    await expect(p.generate({ prompt: "x", width: 1280, height: 720 })).rejects.toMatchObject({
      provider: "minimax-image",
      status: 401,
    });
    statusToSend = 200;
    responseBody = {
      id: "x",
      data: { image_base64: [TINY_JPEG_B64] },
      metadata: { success_count: 1, failed_count: 0 },
      base_resp: { status_code: 0, status_msg: "success" },
    };
  });

  it("throws explicit message when MINIMAX_API_KEY is missing", async () => {
    delete process.env["MINIMAX_API_KEY"];
    const p = new MiniMaxImageProvider({ apiHost: baseUrl });
    await expect(p.generate({ prompt: "x", width: 1280, height: 720 })).rejects.toThrow(
      /MINIMAX_API_KEY not set/,
    );
    process.env["MINIMAX_API_KEY"] = "test-key";
  });

  it("does not include the key in error messages", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    statusToSend = 500;
    responseBody = { base_resp: { status_code: 1000, status_msg: "internal error" } };
    const p = new MiniMaxImageProvider({ apiHost: baseUrl, retrySleeps: [1, 1, 1] });
    const err = await p.generate({ prompt: "x", width: 1280, height: 720 }).catch((e) => e);
    expect(String(err).includes("test-key")).toBe(false);
    statusToSend = 200;
    responseBody = {
      id: "x",
      data: { image_base64: [TINY_JPEG_B64] },
      metadata: { success_count: 1, failed_count: 0 },
      base_resp: { status_code: 0, status_msg: "success" },
    };
  });

  it("surfaces envelope errors (HTTP 200 + base_resp.status_code != 0)", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    // quota-exhausted shape observed against the real API (status 2056)
    responseBody = {
      id: "x",
      data: null,
      base_resp: {
        status_code: 2056,
        status_msg:
          "Token Plan usage limit reached: Upgrade your Token Plan or purchase Credits for more usage.",
      },
    };
    const p = new MiniMaxImageProvider({ apiHost: baseUrl, retrySleeps: [1, 1, 1] });
    await expect(
      p.generate({ prompt: "x", width: 1280, height: 720 }),
    ).rejects.toThrow(/2056.*usage limit/i);
    responseBody = {
      id: "x",
      data: { image_base64: [TINY_JPEG_B64] },
      metadata: { success_count: 1, failed_count: 0 },
      base_resp: { status_code: 0, status_msg: "success" },
    };
  });

  it("fails when content safety blocks all images (success_count 0)", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    responseBody = {
      id: "x",
      data: { image_base64: [] },
      metadata: { success_count: 0, failed_count: 1 },
      base_resp: { status_code: 0, status_msg: "success" },
    };
    const p = new MiniMaxImageProvider({ apiHost: baseUrl });
    await expect(p.generate({ prompt: "blocked", width: 1280, height: 720 })).rejects.toThrow(
      /no image.*content safety|blocked/i,
    );
    responseBody = {
      id: "x",
      data: { image_base64: [TINY_JPEG_B64] },
      metadata: { success_count: 1, failed_count: 0 },
      base_resp: { status_code: 0, status_msg: "success" },
    };
  });
});
