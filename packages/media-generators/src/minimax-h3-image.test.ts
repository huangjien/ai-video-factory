import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  autoConstraintMarkers,
  MiniMaxH3ImageProvider,
} from "./minimax-h3-image.js";

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

// 1x1 red JPEG (same known-good constant the image-01 tests use).
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDX/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+v//Z";

const B64_RESPONSE = {
  created: 1,
  data: [
    {
      b64_json: TINY_JPEG_B64,
      size: "1280x720",
      revised_prompt: "a better prompt",
    },
  ],
  usage: { generated_images: 1, total_tokens: 100, input_tokens: 20, output_tokens: 80 },
  output_format: "jpeg",
};

describe("MiniMaxH3ImageProvider — /v1/images/generations + /v1/images/edits", () => {
  let server: Server;
  let baseUrl: string;
  let lastAuth: string | undefined;
  let lastPath: string | undefined;
  let lastBody: string | undefined;
  let statusToSend = 200;
  let responseBody: unknown = B64_RESPONSE;
  let attempts = 0;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      attempts += 1;
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

  it("posts to the generations endpoint with the exact size", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    const p = new MiniMaxH3ImageProvider({ apiHost: baseUrl });
    const result = await p.generate({
      prompt: "a red apple",
      width: 1280,
      height: 720,
    });
    expect(lastPath).toBe("/v1/images/generations");
    const body = JSON.parse(lastBody ?? "{}");
    expect(body.model).toBe("MiniMax-H3-Image");
    expect(body.size).toBe("1280x720");
    expect(body.response_format).toBe("b64_json");
    expect(result.contentType).toBe("image/jpeg");
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it("uses the edits endpoint when reference images are present", async () => {
    const p = new MiniMaxH3ImageProvider({ apiHost: baseUrl });
    await p.generate({
      prompt: "the same apple, but green",
      width: 1280,
      height: 720,
      referenceImages: [{ base64: TINY_JPEG_B64, contentType: "image/jpeg" }],
    });
    expect(lastPath).toBe("/v1/images/edits");
    const body = JSON.parse(lastBody ?? "{}");
    expect(body.images[0].image_url).toBe(
      `data:image/jpeg;base64,${TINY_JPEG_B64}`,
    );
  });

  it("sends the Highspeed model when configured", async () => {
    const p = new MiniMaxH3ImageProvider({
      apiHost: baseUrl,
      model: "MiniMax-H3-Image-Highspeed",
    });
    await p.generate({ prompt: "x", width: 1280, height: 720 });
    const body = JSON.parse(lastBody ?? "{}");
    expect(body.model).toBe("MiniMax-H3-Image-Highspeed");
  });

  it("sends disable_prompt_enhanced when configured", async () => {
    const p = new MiniMaxH3ImageProvider({
      apiHost: baseUrl,
      disablePromptEnhanced: true,
    });
    await p.generate({ prompt: "x", width: 1280, height: 720 });
    const body = JSON.parse(lastBody ?? "{}");
    expect(body.disable_prompt_enhanced).toBe(true);
    const def = new MiniMaxH3ImageProvider({ apiHost: baseUrl });
    await def.generate({ prompt: "x", width: 1280, height: 720 });
    const body2 = JSON.parse(lastBody ?? "{}");
    expect(body2.disable_prompt_enhanced).toBe(false);
  });

  it("rejects a size below the API's area floor before spending", async () => {
    const p = new MiniMaxH3ImageProvider({ apiHost: baseUrl });
    await expect(
      p.generate({ prompt: "x", width: 640, height: 360 }),
    ).rejects.toThrow(/655360–20000000 px/);
  });

  it("rejects a ratio beyond 3:1 before spending", async () => {
    const p = new MiniMaxH3ImageProvider({ apiHost: baseUrl });
    await expect(
      p.generate({ prompt: "x", width: 3000, height: 900 }),
    ).rejects.toThrow(/beyond 3:1/);
  });

  it("surfaces OpenAI-style HTTP errors with the status", async () => {
    statusToSend = 429;
    responseBody = {
      type: "error",
      error: { code: "2056", message: "M Plan usage limit reached" },
    };
    const p = new MiniMaxH3ImageProvider({ apiHost: baseUrl });
    const err = await p
      .generate({ prompt: "x", width: 1280, height: 720 })
      .catch((e) => e);
    expect(err.status).toBe(429);
    expect(String(err)).toContain("429");
    statusToSend = 200;
    responseBody = B64_RESPONSE;
  });

  it("never retries a 429 (each attempt re-spends)", async () => {
    statusToSend = 429;
    responseBody = {
      type: "error",
      error: { code: "2056", message: "M Plan usage limit reached" },
    };
    attempts = 0;
    const p = new MiniMaxH3ImageProvider({ apiHost: baseUrl });
    await expect(
      p.generate({ prompt: "x", width: 1280, height: 720 }),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
    statusToSend = 200;
    responseBody = B64_RESPONSE;
  });

  it("reports per-image content-safety rejection", async () => {
    responseBody = {
      created: 1,
      data: [{ error: { code: "content_moderation", message: "blocked" } }],
      usage: { generated_images: 0 },
    };
    const p = new MiniMaxH3ImageProvider({ apiHost: baseUrl });
    const err = await p
      .generate({ prompt: "x", width: 1280, height: 720 })
      .catch((e) => e);
    expect(String(err)).toContain("rejected");
    responseBody = B64_RESPONSE;
  });

  it("throws an explicit error when MINIMAX_API_KEY is missing", async () => {
    delete process.env["MINIMAX_API_KEY"];
    const p = new MiniMaxH3ImageProvider({ apiHost: baseUrl });
    await expect(
      p.generate({ prompt: "x", width: 1280, height: 720 }),
    ).rejects.toThrow(/MINIMAX_API_KEY not set/);
    process.env["MINIMAX_API_KEY"] = "test-key";
  });

  describe("constraintGuard — enhancement ON, constraints guaranteed", () => {
    /** Swap the shared server for one scripted per-call responses. */
    async function useScriptedServer(
      responses: unknown[],
    ): Promise<string[]> {
      server.close();
      const bodies: string[] = [];
      let call = 0;
      const scripted = createServer((req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          bodies.push(Buffer.concat(chunks).toString("utf8"));
          const index = Math.min(call, responses.length - 1);
          call += 1;
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(responses[index]));
        });
      });
      await new Promise<void>((resolve) => {
        scripted.listen(0, "127.0.0.1", () => {
          baseUrl = `http://127.0.0.1:${(scripted.address() as AddressInfo).port}`;
          resolve();
        });
      });
      server = scripted;
      return bodies;
    }

    it("auto-extracts palette hex codes and the no-text rule as markers", () => {
      expect(
        autoConstraintMarkers(
          "palette: sky blue #7FB3D5, cream #F6EEDC; no text, no watermark",
        ),
      ).toEqual(["#7FB3D5", "#F6EEDC", "no text"]);
    });

    it("returns no markers for a prompt without constraints", () => {
      expect(autoConstraintMarkers("a red apple")).toEqual([]);
    });

    it("regenerates with the verbatim brief when the rewrite drops a marker", async () => {
      // Call 1: enhancement ON — the rewrite dropped the palette hex.
      // Call 2: enhancement OFF — our verbatim brief, constraints intact.
      const bodies = await useScriptedServer([
        { created: 1, data: [{ b64_json: TINY_JPEG_B64, revised_prompt: "a prettier apple" }] },
        {
          created: 2,
          data: [{ b64_json: TINY_JPEG_B64, revised_prompt: "a red apple #FF0000, no text" }],
        },
      ]);
      const p = new MiniMaxH3ImageProvider({ apiHost: baseUrl });
      const result = await p.generate({
        prompt: "a red apple #FF0000, no text",
        width: 1280,
        height: 720,
      });
      expect(result.bytes.length).toBeGreaterThan(0);
      expect(bodies).toHaveLength(2);
      const first = JSON.parse(bodies[0] ?? "{}");
      const second = JSON.parse(bodies[1] ?? "{}");
      expect(first.disable_prompt_enhanced).toBe(false);
      expect(second.disable_prompt_enhanced).toBe(true);
    });

    it("keeps the enhanced image when the rewrite preserves every marker", async () => {
      const bodies = await useScriptedServer([
        {
          created: 1,
          data: [
            {
              b64_json: TINY_JPEG_B64,
              revised_prompt: "a red apple #ff0000 with No Text anywhere",
            },
          ],
        },
      ]);
      const p = new MiniMaxH3ImageProvider({ apiHost: baseUrl });
      const result = await p.generate({
        prompt: "a red apple #FF0000, no text",
        width: 1280,
        height: 720,
      });
      expect(result.bytes.length).toBeGreaterThan(0);
      expect(bodies).toHaveLength(1);
    });

    it("does NOT claim reference support — the image API 400s on one", () => {
      // Verified live 2026-11-20: plain generation works (a 1920x1080 ink
      // painting came back in one call), but a request carrying a
      // reference picture answers 400 bad_request. A provider that claims
      // a capability it cannot deliver makes the CALLER route the scene
      // to it and the scene fail.
      const p = new MiniMaxH3ImageProvider();
      expect(p.supportsReferences).toBe(false);
    });

    it("passes constraintGuard: [] to disable the guard", async () => {
      const bodies = await useScriptedServer([
        { created: 1, data: [{ b64_json: TINY_JPEG_B64, revised_prompt: "a prettier apple" }] },
      ]);
      const p = new MiniMaxH3ImageProvider({
        apiHost: baseUrl,
        constraintGuard: [],
      });
      const result = await p.generate({
        prompt: "a red apple #FF0000, no text",
        width: 1280,
        height: 720,
      });
      expect(result.bytes.length).toBeGreaterThan(0);
      expect(bodies).toHaveLength(1);
    });
  });
});
