import { describe, expect, it } from "vitest";
import { FakeTTSProvider } from "./fake.js";

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
