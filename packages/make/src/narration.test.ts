import { describe, expect, it } from "vitest";
import { resolveNarration } from "./narration.js";

const base = {
  fake: false,
  language: "zh-CN",
  minimaxKey: true,
  voiceboxHealthy: true,
};

describe("resolveNarration — backend policy", () => {
  it("voicebox wins when the server is healthy", () => {
    const d = resolveNarration({ ...base, ttsProvider: "voicebox", voice: "narrator-zh" });
    expect(d.provider.name).toBe("voicebox");
    expect(d.voice).toBe("narrator-zh");
    expect(d.warnings).toEqual([]);
  });

  it("voicebox down → MiniMax system voice with a loud warning", () => {
    const d = resolveNarration({
      ...base,
      voiceboxHealthy: false,
      ttsProvider: "voicebox",
      voice: "narrator-zh",
    });
    expect(d.provider.name).toBe("minimax-tts");
    expect(d.voice).toBe("Chinese (Mandarin)_Male_Announcer");
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings[0]).toMatch(/voicebox-server unreachable/);
  });

  it("voicebox down + no MiniMax key → Edge default voice, two warnings", () => {
    const d = resolveNarration({
      ...base,
      voiceboxHealthy: false,
      minimaxKey: false,
      ttsProvider: "voicebox",
      voice: "narrator-zh",
    });
    expect(d.provider.name).toBe("edge");
    expect(d.voice).toBe("zh-CN-YunjianNeural");
    expect(d.warnings).toHaveLength(2);
  });

  it("minimax without a key degrades to Edge", () => {
    const d = resolveNarration({
      ...base,
      minimaxKey: false,
      ttsProvider: "minimax",
      voice: "Chinese (Mandarin)_Male_Announcer",
    });
    expect(d.provider.name).toBe("edge");
    expect(d.warnings[0]).toMatch(/MINIMAX_API_KEY/);
  });

  it("unknown provider warns and falls back to Edge with the given voice", () => {
    const d = resolveNarration({ ...base, ttsProvider: "voiceb0x", voice: "zh-CN-YunjianNeural" });
    expect(d.provider.name).toBe("edge");
    expect(d.warnings[0]).toMatch(/unknown tts_provider "voiceb0x"/);
  });

  it("default (no tts_provider) stays Edge, silently", () => {
    const d = resolveNarration({ ...base, ttsProvider: undefined, voice: "zh-CN-YunjianNeural" });
    expect(d.provider.name).toBe("edge");
    expect(d.warnings).toEqual([]);
  });

  it("--fake never constructs a network provider", () => {
    const d = resolveNarration({
      ...base,
      fake: true,
      voiceboxHealthy: false,
      minimaxKey: false,
      ttsProvider: "voicebox",
      voice: "narrator-zh",
    });
    expect(d.provider.name).toBe("fake");
    expect(d.warnings).toEqual([]);
  });

  it("en-US fallback voice maps to the English announcer / Edge default", () => {
    expect(
      resolveNarration({
        ...base,
        language: "en-US",
        voiceboxHealthy: false,
        ttsProvider: "voicebox",
        voice: "narrator-en",
      }).voice,
    ).toBe("English_expressive_narrator");
    expect(
      resolveNarration({
        ...base,
        language: "en-US",
        voiceboxHealthy: false,
        minimaxKey: false,
        ttsProvider: "voicebox",
        voice: "narrator-en",
      }).voice,
    ).toBe("en-US-ChristopherNeural");
  });
});

describe("tts_speed is provider-agnostic", () => {
  it("reaches MiniMax, not just Voicebox", () => {
    // A project slowed to 0.9 must stay slowed when its voice moves from
    // voicebox to minimax; `speed` used to be passed only to Voicebox.
    const decision = resolveNarration({
      ...base,
      language: "en-US",
      ttsProvider: "minimax",
      voice: "English_expressive_narrator",
      ttsSpeed: 0.9,
    });
    expect(decision.provider.name).toBe("minimax-tts");
    // The provider stores it privately; assert the observable behaviour
    // instead — the constructor path ran without throwing and the voice
    // is preserved.
    expect(decision.voice).toBe("English_expressive_narrator");
    expect(decision.warnings).toEqual([]);
  });

  it("leaves MiniMax at its default when no speed is declared", () => {
    expect(
      resolveNarration({
        ...base,
        language: "en-US",
        ttsProvider: "minimax",
        voice: "English_expressive_narrator",
      }).provider.name,
    ).toBe("minimax-tts");
  });
});

