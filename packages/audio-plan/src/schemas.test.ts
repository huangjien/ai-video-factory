import { describe, expect, it } from "vitest";
import { renderAudioConfig } from "./agent.js";
import { AudioConfigSchema, DEFAULT_AUDIO_CONFIG } from "./schemas.js";

describe("AudioConfigSchema", () => {
  it("accepts the canonical shape", () => {
    const r = AudioConfigSchema.safeParse({
      voice: "zh-CN-XiaoxiaoNeural",
      bgm: "calm",
      bgm_fade_in_sec: 1.5,
      bgm_fade_out_sec: 2.0,
      sfx: { scene_2: "whoosh" },
    });
    expect(r.success).toBe(true);
  });

  it("accepts bgm: null to disable BGM", () => {
    const r = AudioConfigSchema.safeParse({ bgm: null });
    expect(r.success).toBe(true);
  });

  it("rejects negative fades", () => {
    const r = AudioConfigSchema.safeParse({ bgm_fade_in_sec: -1 });
    expect(r.success).toBe(false);
  });

  it("rejects fades > 10s (sanity)", () => {
    expect(AudioConfigSchema.safeParse({ bgm_fade_in_sec: 100 }).success).toBe(false);
  });

  it("accepts pause_between_sentences_sec 0–5 sec", () => {
    expect(
      AudioConfigSchema.safeParse({ pause_between_sentences_sec: 1 }).success,
    ).toBe(true);
  });
  it("rejects pause_between_sentences_sec > 5", () => {
    expect(
      AudioConfigSchema.safeParse({ pause_between_sentences_sec: 10 }).success,
    ).toBe(false);
  });
  it("treats omission as 0 (not an error)", () => {
    const r = AudioConfigSchema.safeParse({ bgm: "calm" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.pause_between_sentences_sec).toBeUndefined();
    }
  });
});

describe("renderAudioConfig (YAML serializer)", () => {
  it("renders a complete config with SFX", () => {
    const yaml = renderAudioConfig({
      voice: "zh-CN-XiaoxiaoNeural",
      bgm: "calm",
      bgm_fade_in_sec: 1.5,
      bgm_fade_out_sec: 2.0,
      sfx: { scene_2: "whoosh", scene_4: "ding" },
    });
    expect(yaml).toContain("voice: zh-CN-XiaoxiaoNeural");
    expect(yaml).toContain('bgm: "calm"');
    expect(yaml).toContain("bgm_fade_in_sec: 1.5");
    expect(yaml).toContain("sfx:");
    expect(yaml).toContain("scene_2:");
    expect(yaml).toContain('"whoosh"');
  });

  it("renders null bgm as literal null", () => {
    const yaml = renderAudioConfig({ bgm: null });
    expect(yaml).toContain("bgm: null");
  });

  it("emits pause_between_sentences_sec when > 0", () => {
    const yaml = renderAudioConfig({
      bgm: "calm",
      pause_between_sentences_sec: 1.0,
    });
    expect(yaml).toContain("pause_between_sentences_sec: 1");
  });

  it("omits pause_between_sentences_sec when 0 / undefined", () => {
    const yaml = renderAudioConfig({ bgm: "calm" });
    expect(yaml).not.toContain("pause_between_sentences_sec");
    const yaml0 = renderAudioConfig({
      bgm: "calm",
      pause_between_sentences_sec: 0,
    });
    expect(yaml0).not.toContain("pause_between_sentences_sec");
  });

  it("renders empty sfx as `{}`", () => {
    const yaml = renderAudioConfig({ ...DEFAULT_AUDIO_CONFIG, sfx: {} });
    expect(yaml).toContain("sfx: {}");
  });

  it("omits optional voice when not set", () => {
    const yaml = renderAudioConfig({ bgm: "calm" });
    expect(yaml).not.toContain("voice:");
  });
});
