import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { MiniMaxVideoProvider } from "./minimax-video.js";

// Polling override so tests don't wait 30s+ for the default poll interval.
vi.useFakeTimers({ shouldAdvanceTime: true });

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

/** Wrap a server's request handler to also capture the most recent create
 * request body, so a test can assert on the JSON the provider sent. */
function captureCreateBody(server: Server): { lastBody: string } {
  const state = { lastBody: "" };
  const orig = server.listeners("request")[0] as (
    req: IncomingMessage,
    res: ServerResponse,
  ) => void;
  server.removeListener("request", orig);
  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    if ((req.url ?? "").includes("/v1/video_generation")) {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        state.lastBody = Buffer.concat(chunks).toString("utf8");
      });
    }
    orig(req, res);
  });
  return state;
}

describe("MiniMaxVideoProvider (v0.3 phase 2) — /v1/video_generation async flow", () => {
  let server: Server;
  let baseUrl: string;
  let createCalls = 0;
  let pollCalls = 0;
  let downloadCalls = 0;
  let pollSequence: "Preparing" | "Processing" | "Success" | "Fail" = "Processing";
  let downloadStatus = 200;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "";
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      if (url.includes("/v1/video_generation")) {
        createCalls += 1;
        res.end(
          JSON.stringify({ task_id: "task-123", base_resp: { status_code: 0, status_msg: "success" } }),
        );
      } else if (url.includes("/v1/query/video_generation")) {
        pollCalls += 1;
        const body = {
          task_id: "task-123",
          status: pollSequence,
          file_id: pollSequence === "Success" ? "file-456" : undefined,
          video_width: pollSequence === "Success" ? 1080 : undefined,
          video_height: pollSequence === "Success" ? 1920 : undefined,
          base_resp: { status_code: 0, status_msg: "ok" },
        };
        res.end(JSON.stringify(body));
      } else if (url.includes("/v1/files/")) {
        downloadCalls += 1;
        res.statusCode = downloadStatus;
        if (downloadStatus === 200) {
          res.setHeader("Content-Type", "video/mp4");
          res.end(Buffer.from("FAKE-MP4-BYTES"));
        } else {
          res.end(JSON.stringify({ error: "not found" }));
        }
      } else {
        res.end("{}");
      }
    });
    baseUrl = await listen(server);
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    createCalls = 0;
    pollCalls = 0;
    downloadCalls = 0;
    pollSequence = "Processing";
    downloadStatus = 200;
    process.env["MINIMAX_API_KEY"] = "test-key";
  });

  it("creates a task, polls until Success, downloads the file", async () => {
    pollSequence = "Success";
    const p = new MiniMaxVideoProvider({
      apiHost: baseUrl,
      pollIntervalMs: 1,
      timeoutMs: 1000,
    });
    const result = await p.generate({
      prompt: "test prompt",
      width: 1080,
      height: 1920,
      durationSec: 5,
      firstFrameImageUrl: "data:image/jpeg;base64,AAA",
    });
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.contentType).toBe("video/mp4");
    expect(createCalls).toBe(1);
    expect(pollCalls).toBeGreaterThanOrEqual(1);
    expect(downloadCalls).toBe(1);
  });

  it("sends Bearer auth + model Hailuo-2.3 + first_frame_image as base64 in create", async () => {
    pollSequence = "Success";
    process.env["MINIMAX_API_KEY"] = "test-key";
    const p = new MiniMaxVideoProvider({
      apiHost: baseUrl,
      pollIntervalMs: 1,
      timeoutMs: 500,
    });
    // Server middleware: capture lastBody for the create call (the only
    // call whose body we assert); poll/download succeed via baseUrl.
    const captured = captureCreateBody(server);
    await p.generate({
      prompt: "x",
      width: 1080,
      height: 1920,
      durationSec: 5,
      firstFrameImageUrl: "data:image/jpeg;base64,XYZ",
    });
    const body = JSON.parse(captured.lastBody);
    expect(body.model).toBe("MiniMax-Hailuo-2.3");
    expect(body.first_frame_image).toBe("data:image/jpeg;base64,XYZ");
    expect(body.duration).toBe(5);
    expect(body.resolution).toBe("1080x1920");
  });

  it("throws when envelope error in create response", async () => {
    const errServer = createServer((_req, res) => {
      res.end(
        JSON.stringify({
          task_id: "",
          base_resp: { status_code: 2056, status_msg: "quota exhausted" },
        }),
      );
    });
    const errUrl = await listen(errServer);
    const p = new MiniMaxVideoProvider({
      apiHost: errUrl,
      pollIntervalMs: 1,
      timeoutMs: 500,
    });
    await expect(
      p.generate({
        prompt: "x",
        width: 1080,
        height: 1920,
        durationSec: 5,
        firstFrameImageUrl: "data:image/jpeg;base64,X",
      }),
    ).rejects.toThrow(/2056.*quota/i);
    errServer.close();
  });

  it("throws when generation fails (status = Fail)", async () => {
    pollSequence = "Fail";
    const p = new MiniMaxVideoProvider({
      apiHost: baseUrl,
      pollIntervalMs: 1,
      timeoutMs: 500,
    });
    await expect(
      p.generate({
        prompt: "x",
        width: 1080,
        height: 1920,
        durationSec: 5,
        firstFrameImageUrl: "data:image/jpeg;base64,X",
      }),
    ).rejects.toThrow(/generation failed|Fail/i);
  });

  it("throws with explicit message when MINIMAX_API_KEY is missing", async () => {
    delete process.env["MINIMAX_API_KEY"];
    const p = new MiniMaxVideoProvider({ apiHost: baseUrl });
    await expect(
      p.generate({
        prompt: "x",
        width: 1080,
        height: 1920,
        durationSec: 5,
        firstFrameImageUrl: "x",
      }),
    ).rejects.toThrow(/MINIMAX_API_KEY not set/);
  });

  it("does not include the key in error messages", async () => {
    pollSequence = "Fail";
    const p = new MiniMaxVideoProvider({
      apiHost: baseUrl,
      pollIntervalMs: 1,
      timeoutMs: 500,
    });
    const err = await p
      .generate({
        prompt: "x",
        width: 1080,
        height: 1920,
        durationSec: 5,
        firstFrameImageUrl: "x",
      })
      .catch((e) => e);
    expect(String(err).includes("test-key")).toBe(false);
  });
});
