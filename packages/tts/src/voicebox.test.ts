import { describe, expect, it } from "vitest";
import { VoiceboxTTSProvider } from "./voicebox.js";
import { TTSError } from "./provider.js";

/** Minimal fake Voicebox backend: routes on (method, path). */
function makeFetch(
  routes: Array<{
    method: string;
    path: string;
    reply: () => Response;
  }>,
): { fetch: typeof globalThis.fetch; requests: Array<{ method: string; path: string; body?: unknown }> } {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const handle = async (
    input: string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body =
      init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path: url.pathname, body });
    const route = routes.find(
      (r) => r.method === method && r.path === url.pathname,
    );
    if (route === undefined) {
      return new Response(
        JSON.stringify({ detail: `no route ${method} ${url.pathname}` }),
        { status: 404 },
      );
    }
    return route.reply();
  };
  return { fetch: handle as typeof globalThis.fetch, requests };
}

const PROFILES = [
  { id: "a9913505-c711-4d68-95ec-ac6c0cc4f371", name: "narrator-zh" },
  { id: "b1230000-0000-0000-0000-000000000000", name: "narrator-en" },
];

const WAV_MAGIC = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 5, 6, 7, 8]);

describe("VoiceboxTTSProvider", () => {
  it("resolves the profile by name, maps zh-CN→zh, polls history, returns WAV + duration", async () => {
    let polls = 0;
    const { fetch, requests } = makeFetch([
      {
        method: "GET",
        path: "/profiles",
        reply: () => new Response(JSON.stringify(PROFILES)),
      },
      {
        method: "POST",
        path: "/generate",
        reply: () =>
          new Response(JSON.stringify({ id: "gen-1", status: "generating" })),
      },
      {
        method: "GET",
        path: "/history/gen-1",
        reply: () => {
          polls += 1;
          // First poll still generating, second completed — exercises the
          // poll loop and its sleep.
          const status = polls === 1 ? "generating" : "completed";
          return new Response(
            JSON.stringify({ id: "gen-1", status, duration: 7.657 }),
          );
        },
      },
      {
        method: "GET",
        path: "/audio/gen-1",
        reply: () => new Response(WAV_MAGIC),
      },
    ]);

    const provider = new VoiceboxTTSProvider({ fetchImpl: fetch, pollIntervalMs: 1 });
    const result = await provider.synthesize({
      text: "第一场的话。",
      voice: "Narrator-ZH", // case-insensitive name resolution
      language: "zh-CN",
    });

    expect(result.audio).toEqual(WAV_MAGIC);
    expect(result.durationMs).toBe(7657);
    expect(result.words).toEqual([]);
    expect(polls).toBe(2);
    const generate = requests.find((r) => r.method === "POST" && r.path === "/generate");
    expect(generate?.body).toMatchObject({
      profile_id: "a9913505-c711-4d68-95ec-ac6c0cc4f371",
      text: "第一场的话。",
      language: "zh", // GenerationRequest rejects "zh-CN"
    });
  });

  it("passes engine/model_size when configured", async () => {
    const { fetch, requests } = makeFetch([
      { method: "GET", path: "/profiles", reply: () => new Response(JSON.stringify(PROFILES)) },
      {
        method: "POST",
        path: "/generate",
        reply: () => new Response(JSON.stringify({ id: "gen-2" })),
      },
      {
        method: "GET",
        path: "/history/gen-2",
        reply: () => new Response(JSON.stringify({ id: "gen-2", status: "completed", duration: 1 })),
      },
      { method: "GET", path: "/audio/gen-2", reply: () => new Response(WAV_MAGIC) },
    ]);
    const provider = new VoiceboxTTSProvider({
      fetchImpl: fetch,
      engine: "qwen",
      modelSize: "0.6B",
      pollIntervalMs: 1,
    });
    await provider.synthesize({ text: "x", voice: "narrator-en", language: "en-US" });
    const generate = requests.find((r) => r.path === "/generate");
    expect(generate?.body).toMatchObject({ engine: "qwen", model_size: "0.6B", language: "en" });
  });

  it("throws TTSError carrying the server's error when the generation fails", async () => {
    const { fetch } = makeFetch([
      { method: "GET", path: "/profiles", reply: () => new Response(JSON.stringify(PROFILES)) },
      { method: "POST", path: "/generate", reply: () => new Response(JSON.stringify({ id: "gen-3" })) },
      {
        method: "GET",
        path: "/history/gen-3",
        reply: () =>
          new Response(
            JSON.stringify({ id: "gen-3", status: "failed", error: "model OOM" }),
          ),
      },
    ]);
    const provider = new VoiceboxTTSProvider({ fetchImpl: fetch, pollIntervalMs: 1 });
    const promise = provider.synthesize({ text: "x", voice: "narrator-zh", language: "zh-CN" });
    await expect(promise).rejects.toThrow(/model OOM/);
    await expect(promise).rejects.toBeInstanceOf(TTSError);
  });

  it("lists known profile names when the requested voice is unknown", async () => {
    const { fetch } = makeFetch([
      { method: "GET", path: "/profiles", reply: () => new Response(JSON.stringify(PROFILES)) },
    ]);
    const provider = new VoiceboxTTSProvider({ fetchImpl: fetch });
    await expect(
      provider.synthesize({ text: "x", voice: "no-such-voice", language: "zh-CN" }),
    ).rejects.toThrow(/no-such-voice.*narrator-zh, narrator-en/s);
  });

  it("surfaces HTTP failures from /generate as TTSError with status", async () => {
    const { fetch } = makeFetch([
      { method: "GET", path: "/profiles", reply: () => new Response(JSON.stringify(PROFILES)) },
      {
        method: "POST",
        path: "/generate",
        reply: () => new Response(JSON.stringify({ detail: "bad request" }), { status: 422 }),
      },
    ]);
    const provider = new VoiceboxTTSProvider({ fetchImpl: fetch });
    const promise = provider.synthesize({ text: "x", voice: "narrator-zh", language: "zh-CN" });
    await expect(promise).rejects.toBeInstanceOf(TTSError);
    await expect(promise).rejects.toMatchObject({ providerName: "voicebox", status: 422 });
  });

  it("times out when the job never completes", async () => {
    const { fetch } = makeFetch([
      { method: "GET", path: "/profiles", reply: () => new Response(JSON.stringify(PROFILES)) },
      { method: "POST", path: "/generate", reply: () => new Response(JSON.stringify({ id: "gen-4" })) },
      {
        method: "GET",
        path: "/history/gen-4",
        reply: () => new Response(JSON.stringify({ id: "gen-4", status: "generating" })),
      },
    ]);
    const provider = new VoiceboxTTSProvider({
      fetchImpl: fetch,
      pollIntervalMs: 1,
      timeoutMs: 50,
    });
    await expect(
      provider.synthesize({ text: "x", voice: "narrator-zh", language: "zh-CN" }),
    ).rejects.toThrow(/did not finish within 50 ms|timed out before request/);
  });
});
