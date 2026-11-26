import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { MAX_CLIP_DOWNLOAD_BYTES, downloadClip } from "./download.js";

/** The network is the boundary under test. */
const fetchMock = vi.hoisted(() => vi.fn());
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  fetchMock.mockReset();
});

interface FakeResponse {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  bytes?: Uint8Array;
}

function stubFetch(
  handler: (url: string, init: RequestInit) => FakeResponse,
): void {
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const body = handler(url, init);
    const bytes = body.bytes ?? new Uint8Array();
    return {
      ok: body.ok ?? true,
      status: body.status ?? 200,
      headers: {
        get: (name: string) => body.headers?.[name.toLowerCase()] ?? null,
      },
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
    };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

describe("downloadClip", () => {
  it("writes the bytes and fingerprints them", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    stubFetch(() => ({ bytes }));
    const clip = await downloadClip("https://archive.example/clip.mp4");
    expect(clip).not.toBeNull();
    expect(clip?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(existsSync(clip!.rawPath)).toBe(true);
    expect(new Uint8Array(readFileSync(clip!.rawPath))).toEqual(bytes);
  });

  it("asks the archive who it is", async () => {
    let seen: RequestInit | undefined;
    stubFetch((_url, init) => {
      seen = init;
      return { bytes: new Uint8Array([7]) };
    });
    await downloadClip("https://archive.example/clip.mp4");
    const headers = (seen?.headers ?? {}) as Record<string, string>;
    expect(headers["User-Agent"]).toContain("ai-video-factory");
  });

  it("passes the caller's signal to the request", async () => {
    let seen: RequestInit | undefined;
    stubFetch((_url, init) => {
      seen = init;
      return { bytes: new Uint8Array([7]) };
    });
    const controller = new AbortController();
    await downloadClip("https://archive.example/clip.mp4", {
      signal: controller.signal,
    });
    expect(seen?.signal).toBe(controller.signal);
  });

  it("gives up on an empty url without touching the network", async () => {
    stubFetch(() => ({ bytes: new Uint8Array([1]) }));
    expect(await downloadClip("")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up on a non-2xx answer", async () => {
    stubFetch(() => ({ ok: false, status: 404 }));
    expect(
      await downloadClip("https://archive.example/missing.mp4"),
    ).toBeNull();
  });

  it("gives up when the announced length is over the cap", async () => {
    stubFetch(() => ({
      headers: { "content-length": String(MAX_CLIP_DOWNLOAD_BYTES + 1) },
      bytes: new Uint8Array([1]),
    }));
    expect(await downloadClip("https://archive.example/huge.mp4")).toBeNull();
  });

  it("gives up when the body turns out to be over the cap", async () => {
    stubFetch(() => ({
      headers: { "content-length": "0" },
      bytes: new Uint8Array(0),
    }));
    // An empty body is not a clip either.
    expect(await downloadClip("https://archive.example/empty.mp4")).toBeNull();
  });

  it("gives up when the network fails", async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error("connection reset");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await downloadClip("https://archive.example/clip.mp4")).toBeNull();
  });
});
