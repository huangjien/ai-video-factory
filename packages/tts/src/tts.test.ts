import { describe, expect, it } from "vitest";
import { FakeTTSProvider } from "./fake.js";
import { mockEdgeTTSProvider } from "./edge-tts.js";

describe("TTSProvider interface (todo 1)", () => {
  it("FakeTTSProvider returns synthetic mp3 bytes and word timestamps", async () => {
    const tts = new FakeTTSProvider();
    const result = await tts.synthesize({
      text: "你好世界",
      voice: "zh-CN-XiaoxiaoNeural",
      language: "zh-CN",
    });
    expect(result.audio.byteLength).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.words.length).toBeGreaterThan(0);
    expect(result.words[0]?.text).toBeTruthy();
    expect(result.words[0]?.startMs).toBe(0);
  });
});

describe("mockEdgeTTSProvider (todo 1) — Microsoft Edge online TTS", () => {
  it("returns audio bytes for the requested voice", async () => {
    const tts = mockEdgeTTSProvider({ sampleBytes: 2048 });
    const result = await tts.synthesize({
      text: "Hello",
      voice: "en-US-EmmaMultilingualNeural",
      language: "en-US",
    });
    expect(result.audio.byteLength).toBe(2048);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("estimates duration from text length when WordBoundary unavailable", async () => {
    const tts = mockEdgeTTSProvider({
      sampleBytes: 1024,
      charsPerSecond: 10,
    });
    const result = await tts.synthesize({
      text: "a".repeat(20),
      voice: "en-US-EmmaMultilingualNeural",
      language: "en-US",
    });
    expect(result.durationMs).toBe(2000);
  });
});
