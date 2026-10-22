import { afterEach, describe, expect, it } from "vitest";
import {
  MINIMAX_SYSTEM_VOICE,
  VoiceboxTTSProvider,
  minimaxSystemVoice,
  parseTtsChoice,
  splitSentences,
  voiceboxStatus,
} from "./voicebox.js";
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

/**
 * Minimal valid 16-bit PCM mono WAV with `seconds` of silence. The byte layout
 * matches what ffmpeg accepts as an input for apad/concat — a bare RIFF
 * magic without the fmt/data chunks is rejected, so ffmpeg-dependent tests
 * (sentencePauseSec) need real header bytes, not the short WAV_MAGIC used by
 * the byte-passthrough tests above.
 */
function makeSilentWav(seconds = 0.1, sampleRate = 8000): Uint8Array {
  const numSamples = Math.max(1, Math.floor(seconds * sampleRate));
  const dataSize = numSamples * 2; // 16-bit mono
  const buf = Buffer.alloc(44 + dataSize);
  let o = 0;
  buf.write("RIFF", o); o += 4;
  buf.writeUInt32LE(36 + dataSize, o); o += 4;
  buf.write("WAVE", o); o += 4;
  buf.write("fmt ", o); o += 4;
  buf.writeUInt32LE(16, o); o += 4;
  buf.writeUInt16LE(1, o); o += 2; // PCM
  buf.writeUInt16LE(1, o); o += 2; // mono
  buf.writeUInt32LE(sampleRate, o); o += 4;
  buf.writeUInt32LE(sampleRate * 2, o); o += 4; // byteRate
  buf.writeUInt16LE(2, o); o += 2; // blockAlign
  buf.writeUInt16LE(16, o); o += 2; // bitsPerSample
  buf.write("data", o); o += 4;
  buf.writeUInt32LE(dataSize, o); o += 4;
  // data is already zero (silent)
  return new Uint8Array(buf);
}

let savedVoiceboxUrl: string | undefined;
afterEach(() => {
  if (savedVoiceboxUrl !== undefined) {
    process.env["VOICEBOX_URL"] = savedVoiceboxUrl;
    savedVoiceboxUrl = undefined;
  } else {
    delete process.env["VOICEBOX_URL"];
  }
});
function withClearedVoiceboxEnv(): void {
  if (savedVoiceboxUrl === undefined) {
    savedVoiceboxUrl = process.env["VOICEBOX_URL"];
  }
  delete process.env["VOICEBOX_URL"];
}

describe("voiceboxStatus (health probe)", () => {
  it("returns healthy: true with profile names when /profiles is 2xx", async () => {
    const { fetch } = makeFetch([
      {
        method: "GET",
        path: "/profiles",
        reply: () =>
          new Response(
            JSON.stringify([
              { id: "uuid-1", name: "narrator-zh" },
              { id: "uuid-2" }, // missing name — must be filtered out
              { id: "uuid-3", name: "narrator-en" },
              { id: "uuid-4", name: "" }, // empty name — must be filtered out
            ]),
          ),
      },
    ]);
    const status = await voiceboxStatus({
      baseUrl: "http://t",
      fetchImpl: fetch,
      timeoutMs: 1000,
    });
    expect(status).toEqual({
      healthy: true,
      profiles: ["narrator-zh", "narrator-en"],
    });
  });

  it("returns healthy: false (and never throws) on a network error", async () => {
    const throwingFetch: typeof globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(
      voiceboxStatus({
        baseUrl: "http://t",
        fetchImpl: throwingFetch,
        timeoutMs: 50,
      }),
    ).resolves.toEqual({ healthy: false, profiles: [] });
  });

  it("returns healthy: false on a non-2xx response from /profiles", async () => {
    const { fetch } = makeFetch([
      {
        method: "GET",
        path: "/profiles",
        reply: () => new Response("upstream down", { status: 503 }),
      },
    ]);
    await expect(
      voiceboxStatus({
        baseUrl: "http://t",
        fetchImpl: fetch,
        timeoutMs: 1000,
      }),
    ).resolves.toEqual({ healthy: false, profiles: [] });
  });

  it("strips trailing slashes before hitting the URL", async () => {
    let requested: string | undefined;
    const fetchImpl: typeof globalThis.fetch = async (input) => {
      requested = String(input);
      return new Response(JSON.stringify([]));
    };
    await voiceboxStatus({
      baseUrl: "http://example.test:9999///",
      fetchImpl,
      timeoutMs: 1000,
    });
    expect(requested).toBe("http://example.test:9999/profiles");
  });

  it("falls back to process.env.VOICEBOX_URL when opts.baseUrl is omitted", async () => {
    withClearedVoiceboxEnv();
    process.env["VOICEBOX_URL"] = "http://envhost:2222";
    let requested: string | undefined;
    const fetchImpl: typeof globalThis.fetch = async (input) => {
      requested = String(input);
      return new Response(JSON.stringify([]));
    };
    await voiceboxStatus({ fetchImpl, timeoutMs: 1000 });
    expect(requested).toBe("http://envhost:2222/profiles");
  });
});

describe("parseTtsChoice", () => {
  it("voicebox:<name> -> {ttsProvider: voicebox, voice: <name>}", () => {
    expect(parseTtsChoice("voicebox:narrator-zh", "zh-CN")).toEqual({
      ttsProvider: "voicebox",
      voice: "narrator-zh",
    });
  });

  it("voicebox: with empty profile omits the voice field (exactOptionalPropertyTypes)", () => {
    const out = parseTtsChoice("voicebox:", "zh-CN");
    expect(out).toEqual({ ttsProvider: "voicebox" });
    expect("voice" in out).toBe(false);
  });

  it("voicebox: trims whitespace around the profile id", () => {
    expect(parseTtsChoice("voicebox: narrator-zh ", "zh-CN")).toEqual({
      ttsProvider: "voicebox",
      voice: "narrator-zh",
    });
  });

  it("minimax-system maps to the platform voice for the matched language", () => {
    expect(parseTtsChoice("minimax-system", "zh-CN")).toEqual({
      ttsProvider: "minimax",
      voice: "Chinese (Mandarin)_Male_Announcer",
    });
    expect(parseTtsChoice("minimax-system", "en-US")).toEqual({
      ttsProvider: "minimax",
      voice: "English_expressive_narrator",
    });
  });

  it("minimax-system falls back to the English voice for unknown languages", () => {
    expect(parseTtsChoice("minimax-system", "ja-JP")).toEqual({
      ttsProvider: "minimax",
      voice: "English_expressive_narrator",
    });
  });

  it('"edge" and unknown strings both resolve to the edge provider with no voice', () => {
    expect(parseTtsChoice("edge", "zh-CN")).toEqual({ ttsProvider: "edge" });
    expect(parseTtsChoice("anything-else", "en-US")).toEqual({
      ttsProvider: "edge",
    });
  });
});

describe("minimaxSystemVoice", () => {
  it("returns the platform voice for known languages", () => {
    expect(minimaxSystemVoice("zh-CN")).toBe(
      "Chinese (Mandarin)_Male_Announcer",
    );
    expect(minimaxSystemVoice("en-US")).toBe("English_expressive_narrator");
  });

  it("falls back to the English voice for unknown or empty languages", () => {
    expect(minimaxSystemVoice("ja-JP")).toBe("English_expressive_narrator");
    expect(minimaxSystemVoice("")).toBe("English_expressive_narrator");
    expect(minimaxSystemVoice("fr-FR")).toBe("English_expressive_narrator");
  });
});

describe("MINIMAX_SYSTEM_VOICE table", () => {
  it("locks the platform docs ids for zh-CN and en-US (probed 2026-10-18)", () => {
    // The values are pinned against platform.minimax.io/docs/faq/system-voice-id;
    // changing them silently would swap narration voices in every deploy.
    expect(MINIMAX_SYSTEM_VOICE["zh-CN"]).toBe(
      "Chinese (Mandarin)_Male_Announcer",
    );
    expect(MINIMAX_SYSTEM_VOICE["en-US"]).toBe(
      "English_expressive_narrator",
    );
  });

  it("carries exactly the two shipped languages", () => {
    expect(Object.keys(MINIMAX_SYSTEM_VOICE).sort()).toEqual([
      "en-US",
      "zh-CN",
    ]);
  });
});

describe("splitSentences (voicebox variant)", () => {
  it("splits English text on .!? and preserves the punctuation", () => {
    expect(splitSentences("Hello. World! Are you?")).toEqual([
      "Hello.",
      "World!",
      "Are you?",
    ]);
  });

  it("splits Chinese text on 。！？ and preserves the punctuation", () => {
    expect(splitSentences("你好。世界！你好吗？")).toEqual([
      "你好。",
      "世界！",
      "你好吗？",
    ]);
  });

  it("trims whitespace between sentences", () => {
    expect(splitSentences("First.   Second!\n   Third?")).toEqual([
      "First.",
      "Second!",
      "Third?",
    ]);
  });

  it("returns [] for empty or whitespace-only input", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   \n\t  ")).toEqual([]);
  });

  it("returns the single trimmed clause when there is no terminal punctuation", () => {
    expect(splitSentences("single clause with no end")).toEqual([
      "single clause with no end",
    ]);
  });

  it("keeps English and CJK terminators in mixed text", () => {
    expect(splitSentences("First sentence. 第二句。第三句！")).toEqual([
      "First sentence.",
      "第二句。",
      "第三句！",
    ]);
  });
});

describe("VoiceboxTTSProvider — additional surface", () => {
  it("resolves the profile by id (UUID) as well as by name", async () => {
    const { fetch } = makeFetch([
      { method: "GET", path: "/profiles", reply: () => new Response(JSON.stringify(PROFILES)) },
      { method: "POST", path: "/generate", reply: () => new Response(JSON.stringify({ id: "g" })) },
      { method: "GET", path: "/history/g", reply: () => new Response(JSON.stringify({ id: "g", status: "completed", duration: 1 })) },
      { method: "GET", path: "/audio/g", reply: () => new Response(WAV_MAGIC) },
    ]);
    const provider = new VoiceboxTTSProvider({ fetchImpl: fetch, pollIntervalMs: 1 });
    await provider.synthesize({
      text: "x",
      voice: "a9913505-c711-4d68-95ec-ac6c0cc4f371",
      language: "zh-CN",
    });
    // No throw means resolution succeeded.
  });

  it("strips a trailing slash on baseUrl before issuing requests", async () => {
    let requested: string | undefined;
    const fetchImpl: typeof globalThis.fetch = async (input) => {
      requested = String(input);
      return new Response(JSON.stringify([]));
    };
    const provider = new VoiceboxTTSProvider({
      fetchImpl,
      baseUrl: "http://example.test//",
      pollIntervalMs: 1,
    });
    await provider
      .synthesize({ text: "x", voice: "x", language: "zh-CN" })
      .catch(() => undefined);
    expect(requested).toBe("http://example.test/profiles");
  });

  it("falls back to process.env.VOICEBOX_URL when opts.baseUrl is omitted", async () => {
    withClearedVoiceboxEnv();
    process.env["VOICEBOX_URL"] = "http://envhost:3333";
    let requested: string | undefined;
    const fetchImpl: typeof globalThis.fetch = async (input) => {
      requested = String(input);
      return new Response(JSON.stringify([]));
    };
    const provider = new VoiceboxTTSProvider({
      fetchImpl,
      pollIntervalMs: 1,
    });
    await provider
      .synthesize({ text: "x", voice: "x", language: "zh-CN" })
      .catch(() => undefined);
    expect(requested).toBe("http://envhost:3333/profiles");
  });

  it("throws TTSError when /generate returns a non-JSON body", async () => {
    const { fetch } = makeFetch([
      { method: "GET", path: "/profiles", reply: () => new Response(JSON.stringify(PROFILES)) },
      { method: "POST", path: "/generate", reply: () => new Response("not json at all") },
    ]);
    const provider = new VoiceboxTTSProvider({ fetchImpl: fetch });
    await expect(
      provider.synthesize({ text: "x", voice: "narrator-zh", language: "zh-CN" }),
    ).rejects.toBeInstanceOf(TTSError);
  });

  it("speed = 1 is a no-op (the returned audio is the unchanged synthesize result)", async () => {
    const { fetch } = makeFetch([
      { method: "GET", path: "/profiles", reply: () => new Response(JSON.stringify(PROFILES)) },
      { method: "POST", path: "/generate", reply: () => new Response(JSON.stringify({ id: "g" })) },
      { method: "GET", path: "/history/g", reply: () => new Response(JSON.stringify({ id: "g", status: "completed", duration: 1 })) },
      { method: "GET", path: "/audio/g", reply: () => new Response(WAV_MAGIC) },
    ]);
    const provider = new VoiceboxTTSProvider({
      fetchImpl: fetch,
      pollIntervalMs: 1,
      speed: 1,
    });
    const result = await provider.synthesize({
      text: "x",
      voice: "narrator-zh",
      language: "zh-CN",
    });
    expect(result.audio).toEqual(WAV_MAGIC);
  });

  it("sentencePauseSec > 0 issues one /generate per sentence and stitches output", async () => {
    const wav = makeSilentWav(0.1);
    let counter = 0;
    const { fetch, requests } = makeFetch([
      { method: "GET", path: "/profiles", reply: () => new Response(JSON.stringify(PROFILES)) },
      {
        method: "POST",
        path: "/generate",
        reply: () =>
          new Response(JSON.stringify({ id: `gen-${++counter}` })),
      },
      ...[1, 2, 3].map((i) => ({
        method: "GET",
        path: `/history/gen-${i}`,
        reply: () =>
          new Response(
            JSON.stringify({ id: `gen-${i}`, status: "completed", duration: 0.1 }),
          ),
      })),
      ...[1, 2, 3].map((i) => ({
        method: "GET",
        path: `/audio/gen-${i}`,
        reply: () => new Response(wav),
      })),
    ]);
    const provider = new VoiceboxTTSProvider({
      fetchImpl: fetch,
      pollIntervalMs: 1,
      sentencePauseSec: 0.5,
    });
    const result = await provider.synthesize({
      text: "First sentence. Second sentence. Third.",
      voice: "narrator-zh",
      language: "zh-CN",
    });

    const generates = requests.filter(
      (r) => r.method === "POST" && r.path === "/generate",
    );
    expect(generates).toHaveLength(3);
    expect(generates.map((g) => (g.body as { text: string }).text)).toEqual([
      "First sentence.",
      "Second sentence.",
      "Third.",
    ]);
    // Stitched audio must be larger than any single piece (three 0.1 s WAVs
    // + ~1 s of apad silence between each, per the 0.5 s sentencePauseSec).
    expect(result.audio.byteLength).toBeGreaterThan(wav.byteLength);
  });
});
