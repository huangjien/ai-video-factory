import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MinimaxTTSProvider } from "./minimax-tts.js";
import { TTSError } from "./provider.js";

function makeFetch(reply: () => Response): {
  fetch: typeof globalThis.fetch;
  bodies: unknown[];
} {
  const bodies: unknown[] = [];
  const handle = async (
    _input: string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    bodies.push(
      init?.body !== undefined ? JSON.parse(String(init.body)) : null,
    );
    return reply();
  };
  return { fetch: handle as typeof globalThis.fetch, bodies };
}

const OK_BODY = {
  data: { audio: Buffer.from("fake-mp3-bytes").toString("hex"), status: 2 },
  extra_info: { audio_length: 2345 },
  base_resp: { status_code: 0, status_msg: "success" },
  trace_id: "t1",
};

describe("MinimaxTTSProvider", () => {
  beforeEach(() => {
    process.env["MINIMAX_API_KEY"] = "test-key";
  });
  afterEach(() => {
    delete process.env["MINIMAX_API_KEY"];
  });

  it("decodes hex audio and maps duration from extra_info", async () => {
    const { fetch, bodies } = makeFetch(
      () => new Response(JSON.stringify(OK_BODY)),
    );
    const provider = new MinimaxTTSProvider({ fetchImpl: fetch });
    const result = await provider.synthesize({
      text: "第一场的话。",
      voice: "huangjien-narrator",
      language: "zh-CN",
    });
    expect(result.durationMs).toBe(2345);
    expect(result.words).toEqual([]);
    expect(bodies[0]).toMatchObject({
      model: "speech-2.8-hd",
      stream: false,
      output_format: "hex",
      language_boost: "Chinese",
      voice_setting: { voice_id: "huangjien-narrator", speed: 1 },
      audio_setting: { format: "mp3", sample_rate: 32000, channel: 1 },
    });
    expect(result.audio).toEqual(new Uint8Array(Buffer.from("fake-mp3-bytes")));
  });

  it("maps en-US to English boost and honors model override", async () => {
    const { fetch, bodies } = makeFetch(
      () => new Response(JSON.stringify(OK_BODY)),
    );
    const provider = new MinimaxTTSProvider({
      fetchImpl: fetch,
      model: "speech-2.8-hd",
    });
    await provider.synthesize({ text: "hi", voice: "v", language: "en-US" });
    expect(bodies[0]).toMatchObject({
      model: "speech-2.8-hd",
      language_boost: "English",
    });
  });

  it("injects <#x#> pause markers between sentences", async () => {
    const { fetch, bodies } = makeFetch(
      () => new Response(JSON.stringify(OK_BODY)),
    );
    const provider = new MinimaxTTSProvider({ fetchImpl: fetch });
    await provider.synthesize({
      text: "第一句。第二句！第三句？",
      voice: "v",
      language: "zh-CN",
      pauseBetweenSentencesSec: 0.35,
    });
    expect(bodies[0]).toMatchObject({
      text: "第一句。<#0.35#>第二句！<#0.35#>第三句？",
    });
  });

  it("throws when MINIMAX_API_KEY is missing", async () => {
    delete process.env["MINIMAX_API_KEY"];
    const { fetch } = makeFetch(() => new Response(JSON.stringify(OK_BODY)));
    const provider = new MinimaxTTSProvider({ fetchImpl: fetch });
    await expect(
      provider.synthesize({ text: "x", voice: "v", language: "zh-CN" }),
    ).rejects.toThrow(/MINIMAX_API_KEY not set/);
  });

  it("surfaces MiniMax base_resp errors carried inside HTTP 200", async () => {
    const { fetch } = makeFetch(
      () =>
        new Response(
          JSON.stringify({
            base_resp: {
              status_code: 1008,
              status_msg: "Insufficient account balance",
            },
            trace_id: "t2",
          }),
        ),
    );
    const provider = new MinimaxTTSProvider({ fetchImpl: fetch });
    const promise = provider.synthesize({
      text: "x",
      voice: "v",
      language: "zh-CN",
    });
    await expect(promise).rejects.toBeInstanceOf(TTSError);
    await expect(promise).rejects.toMatchObject({ status: 1008 });
    await expect(promise).rejects.toThrow(
      /Insufficient account balance.*trace t2/,
    );
  });

  it("surfaces HTTP-level failures and empty audio payloads", async () => {
    const { fetch } = makeFetch(
      () => new Response("gateway boom", { status: 502 }),
    );
    const provider = new MinimaxTTSProvider({ fetchImpl: fetch });
    await expect(
      provider.synthesize({ text: "x", voice: "v", language: "zh-CN" }),
    ).rejects.toThrow(/HTTP 502/);

    const { fetch: fetch2 } = makeFetch(
      () =>
        new Response(
          JSON.stringify({ data: null, base_resp: { status_code: 0 } }),
        ),
    );
    const provider2 = new MinimaxTTSProvider({ fetchImpl: fetch2 });
    await expect(
      provider2.synthesize({ text: "x", voice: "v", language: "zh-CN" }),
    ).rejects.toThrow(/no audio/);
  });
});
