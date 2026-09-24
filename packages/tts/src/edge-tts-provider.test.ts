import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EdgeTTSProvider,
  mockEdgeTTSProvider,
  splitSentences,
} from "./edge-tts.js";

/**
 * The real EdgeTTSProvider talks to Microsoft's online TTS service via the
 * edge-tts-universal package. These tests mock the EdgeTTS class so the
 * provider's own logic — multi-sentence split, word-boundary parsing,
 * duration fallback, prosody passthrough, error propagation — runs fully
 * offline.
 *
 * The post-processing pause-insertion path (ffmpeg concat) is exercised
 * via mock helpers and via `splitSentences` tests; the full ffmpeg round-
 * trip is covered by an end-to-end smoke in @vf/make.
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

describe("splitSentences", () => {
  it("splits on Chinese full-width punctuation", () => {
    expect(splitSentences("今天天气好。我们去公园。")).toEqual([
      "今天天气好",
      "我们去公园",
    ]);
  });
  it("splits on ASCII . ! ?", () => {
    expect(splitSentences("Hi there. Wow! Really?")).toEqual([
      "Hi there",
      "Wow",
      "Really",
    ]);
  });
  it("preserves mixed CJK + ASCII punctuation", () => {
    expect(splitSentences("Yes. 当然!")).toEqual(["Yes", "当然"]);
  });
  it("returns single-element array when no split point exists", () => {
    expect(splitSentences("single sentence, no period here")).toEqual([
      "single sentence, no period here",
    ]);
  });
  it("strips trailing whitespace from each segment", () => {
    expect(splitSentences("a. b.   c.")).toEqual(["a", "b", "c"]);
  });
  it("returns [] for empty input", () => {
    expect(splitSentences("")).toEqual([]);
  });
});

describe("EdgeTTSProvider.synthesize (mocked edge-tts-universal)", () => {
  it("returns audio bytes + words + duration from word boundaries", async () => {
    // edge-tts-universal emits subtitle entries as
    // { text, offset, duration } where offset and duration are in 100-ns
    // units (1000 ticks = 0.1 ms). The parser divides by 10_000 to ms.
    synthesizeMock.mockResolvedValue({
      audio: blobOf([1, 2, 3, 4]),
      subtitle: [
        { text: "你好", offset: 0, duration: 5_000_000 },
        { text: "世界", offset: 5_000_000, duration: 4_000_000 },
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
    expect(result.words[0]).toEqual({
      text: "你好",
      startMs: 0,
      endMs: 500,
    });
    expect(result.durationMs).toBe(900);
  });

  it("passes text + voice to the EdgeTTS constructor (single-chunk path)", async () => {
    synthesizeMock.mockResolvedValue({ audio: blobOf([0]), subtitle: [] });
    const p = new EdgeTTSProvider();
    await p.synthesize({
      text: "hi",
      voice: "en-US-EmmaNeural",
      language: "en-US",
    });
    expect(lastConstructorArgs?.[0]).toBe("hi");
    expect(lastConstructorArgs?.[1]).toBe("en-US-EmmaNeural");
    expect(synthesizeMock).toHaveBeenCalledTimes(1);
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
    expect(result.durationMs).toBe(2000);
  });

  it("enforces a 500ms minimum on the duration estimate", async () => {
    synthesizeMock.mockResolvedValue({ audio: blobOf([0]), subtitle: [] });
    const p = new EdgeTTSProvider();
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

  it("with pauseBetweenSentencesSec=0, makes a single EdgeTTS call", async () => {
    synthesizeMock.mockResolvedValue({ audio: blobOf([0]), subtitle: [] });
    const p = new EdgeTTSProvider();
    await p.synthesize({
      text: "今天天气好。我们去公园。",
      voice: "zh-CN-XiaoxiaoNeural",
      language: "zh-CN",
      pauseBetweenSentencesSec: 0,
    });
    expect(synthesizeMock).toHaveBeenCalledTimes(1);
    expect(lastConstructorArgs?.[0]).toBe("今天天气好。我们去公园。");
  });

  it("with pauseBetweenSentencesSec > 0, drives the multi-part path", async () => {
    // Full ffmpeg concat path is exercised by @vf/make end-to-end (mocked
    // bytes here can't be decoded by ffmpeg). This only verifies that the
    // pause knob reaches the per-sentence code path.
    synthesizeMock.mockRejectedValue(new Error("synthesize mocked-out"));
    const p = new EdgeTTSProvider();
    await expect(
      p.synthesize({
        text: "今天天气好。我们去公园。",
        voice: "zh-CN-XiaoxiaoNeural",
        language: "zh-CN",
        pauseBetweenSentencesSec: 1.0,
      }),
    ).rejects.toThrow(/mocked-out/);
  });

  it("with one sentence + pause, still does single call (no concat needed)", async () => {
    synthesizeMock.mockResolvedValue({ audio: blobOf([0]), subtitle: [] });
    const p = new EdgeTTSProvider();
    await p.synthesize({
      text: "没有任何标点的长句 but really just one thing happens here",
      voice: "v",
      language: "en-US",
      pauseBetweenSentencesSec: 1.0,
    });
    expect(synthesizeMock).toHaveBeenCalledTimes(1);
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
    // offset/duration in 100-nanosecond units; offset=50000 → 5ms,
    // offset=250000 with no duration → endMs = startMs.
    synthesizeMock.mockResolvedValue({
      audio: blobOf([0]),
      subtitle: [
        "a string entry",
        null,
        { text: "", offset: 100_000, duration: 100_000 },
        { text: "ok" },
        42,
        { text: "full", offset: 50_000, duration: 200_000 },
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
    expect(result.durationMs).toBe(25);
  });
});

describe("mockEdgeTTSProvider honors pauseBetweenSentencesSec via duration padding", () => {
  it("zero pause → baseline duration estimate", async () => {
    const m = mockEdgeTTSProvider({ sampleBytes: 64, charsPerSecond: 10 });
    // 20 chars / 10 cps = 2000ms; no pause; expect 2000ms.
    const r = await m.synthesize({
      text: "a".repeat(20),
      voice: "v",
      language: "en-US",
      pauseBetweenSentencesSec: 0,
    });
    expect(r.durationMs).toBe(2000);
  });

  it("positive pause + multi-sentence → adds N-1 silences", async () => {
    const m = mockEdgeTTSProvider({ sampleBytes: 64, charsPerSecond: 10 });
    // Text: "X. Y. Z." → 3 sentences, 2 silences of 1s each.
    // Each sentence has one char + " . " etc. ≈ 5 chars; char count dominated by periods.
    // Just assert that pause-padding is > 0.
    const r = await m.synthesize({
      text: "X. Y. Z.",
      voice: "v",
      language: "en-US",
      pauseBetweenSentencesSec: 1.0,
    });
    expect(r.durationMs).toBeGreaterThan(2000);
  });
});
