import { beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeTTSProvider } from "./edge-tts.js";

/**
 * The real EdgeTTSProvider talks to Microsoft's online TTS service via the
 * edge-tts-universal package. These tests mock the EdgeTTS class so the
 * provider's own logic — audio extraction, word-boundary parsing, duration
 * fallback, prosody passthrough, error propagation — runs fully offline.
 */

type SynthesizeResult = {
  audio: Blob;
  subtitle: unknown;
};

type EdgeTTSConstructorArgs = [
  text: string,
  voice: string,
  opts: { rate?: string; volume?: string; pitch?: string },
];

const synthesizeMock = vi.fn<() => Promise<SynthesizeResult>>();

vi.mock("edge-tts-universal", () => ({
  EdgeTTS: vi.fn().mockImplementation(function (
    this: { synthesize: typeof synthesizeMock },
    ...args: EdgeTTSConstructorArgs
  ) {
    lastConstructorArgs = args;
    this.synthesize = synthesizeMock;
  }),
}));

let lastConstructorArgs: EdgeTTSConstructorArgs | undefined;

function blobOf(bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

beforeEach(() => {
  vi.clearAllMocks();
  lastConstructorArgs = undefined;
});

describe("EdgeTTSProvider.synthesize (mocked edge-tts-universal)", () => {
  it("returns audio bytes + words + duration from word boundaries", async () => {
    synthesizeMock.mockResolvedValue({
      audio: blobOf([1, 2, 3, 4]),
      subtitle: [
        { text: "你好", startMs: 0, endMs: 500 },
        { text: "世界", startMs: 500, endMs: 900 },
      ],
    });
    const p = new EdgeTTSProvider();
    const result = await p.synthesize({
      text: "你好世界",
      voice: "zh-CN-XiaoxiaoNeural",
      language: "zh-CN",
    });
    expect(result.audio.byteLength).toBe(4);
    expect(result.words).toHaveLength(2);
    expect(result.words[0]).toEqual({ text: "你好", startMs: 0, endMs: 500 });
    // durationMs = last word's endMs
    expect(result.durationMs).toBe(900);
  });

  it("passes text + voice to the EdgeTTS constructor", async () => {
    synthesizeMock.mockResolvedValue({ audio: blobOf([0]), subtitle: [] });
    const p = new EdgeTTSProvider();
    await p.synthesize({
      text: "hi",
      voice: "en-US-EmmaNeural",
      language: "en-US",
    });
    expect(lastConstructorArgs?.[0]).toBe("hi");
    expect(lastConstructorArgs?.[1]).toBe("en-US-EmmaNeural");
  });

  it("forwards prosody options (rate/volume/pitch) to EdgeTTS", async () => {
    synthesizeMock.mockResolvedValue({ audio: blobOf([0]), subtitle: [] });
    const p = new EdgeTTSProvider({
      rate: "+10%",
      volume: "-20%",
      pitch: "+5Hz",
    });
    await p.synthesize({ text: "x", voice: "v", language: "en-US" });
    expect(lastConstructorArgs?.[2]).toEqual({
      rate: "+10%",
      volume: "-20%",
      pitch: "+5Hz",
    });
  });

  it("omits prosody keys entirely when not configured", async () => {
    synthesizeMock.mockResolvedValue({ audio: blobOf([0]), subtitle: [] });
    const p = new EdgeTTSProvider();
    await p.synthesize({ text: "x", voice: "v", language: "en-US" });
    expect(lastConstructorArgs?.[2]).toEqual({});
  });

  it("falls back to chars-per-second estimate when no word boundaries", async () => {
    synthesizeMock.mockResolvedValue({ audio: blobOf([0]), subtitle: [] });
    const p = new EdgeTTSProvider({ charsPerSecond: 10 });
    // 20 chars at 10 cps → 2000 ms
    const result = await p.synthesize({
      text: "a".repeat(20),
      voice: "v",
      language: "en-US",
    });
    expect(result.words).toEqual([]);
    expect(result.durationMs).toBe(2000);
  });

  it("uses the default 5 cps estimate when charsPerSecond is unset", async () => {
    synthesizeMock.mockResolvedValue({ audio: blobOf([0]), subtitle: [] });
    const p = new EdgeTTSProvider();
    const result = await p.synthesize({
      text: "a".repeat(10),
      voice: "v",
      language: "en-US",
    });
    // 10 chars at default 5 cps → 2000 ms
    expect(result.durationMs).toBe(2000);
  });

  it("enforces a 500ms minimum on the duration estimate", async () => {
    synthesizeMock.mockResolvedValue({ audio: blobOf([0]), subtitle: [] });
    const p = new EdgeTTSProvider();
    // 1 char at 5 cps → 200ms → clamped to 500
    const result = await p.synthesize({
      text: "a",
      voice: "v",
      language: "en-US",
    });
    expect(result.durationMs).toBe(500);
  });

  it("propagates synthesize() failures", async () => {
    synthesizeMock.mockRejectedValue(new Error("WebSocketError: network down"));
    const p = new EdgeTTSProvider();
    await expect(
      p.synthesize({ text: "x", voice: "v", language: "en-US" }),
    ).rejects.toThrow(/network down/);
  });
});

describe("parseSubtitleToWords edge cases (via synthesize)", () => {
  it("ignores a non-array subtitle", async () => {
    synthesizeMock.mockResolvedValue({
      audio: blobOf([0]),
      subtitle: "not-an-array",
    });
    const p = new EdgeTTSProvider();
    const result = await p.synthesize({
      text: "x",
      voice: "v",
      language: "en-US",
    });
    expect(result.words).toEqual([]);
  });

  it("filters non-object and empty-text entries, defaults missing times to 0", async () => {
    synthesizeMock.mockResolvedValue({
      audio: blobOf([0]),
      subtitle: [
        "a string entry",
        null,
        { text: "", startMs: 10, endMs: 20 },
        { text: "ok" },
        42,
        { text: "full", startMs: 5, endMs: 25 },
      ],
    });
    const p = new EdgeTTSProvider();
    const result = await p.synthesize({
      text: "x",
      voice: "v",
      language: "en-US",
    });
    expect(result.words).toEqual([
      { text: "ok", startMs: 0, endMs: 0 },
      { text: "full", startMs: 5, endMs: 25 },
    ]);
    // durationMs from last word's endMs = 25
    expect(result.durationMs).toBe(25);
  });
});
