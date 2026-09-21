import { describe, expect, it } from "vitest";
import { MixSpecSchema, parseMixYaml } from "./index.js";

describe("MixSpecSchema (todo 1) — §55-style mix.yaml convention", () => {
  it("accepts a minimal spec with just BGM", () => {
    const r = MixSpecSchema.safeParse({ bgm: "calm" });
    expect(r.success).toBe(true);
  });

  it("accepts BGM + SFX cues per scene", () => {
    const r = MixSpecSchema.safeParse({
      bgm: "calm",
      sfx: { scene_2: "whoosh", scene_4: "ding" },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sfx?.scene_2).toBe("whoosh");
    }
  });

  it("accepts optional fade-in/fade-out durations", () => {
    const r = MixSpecSchema.safeParse({
      bgm: "calm",
      bgm_fade_in_sec: 1.5,
      bgm_fade_out_sec: 2,
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative fade durations", () => {
    const r = MixSpecSchema.safeParse({ bgm_fade_in_sec: -1 });
    expect(r.success).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    const r = MixSpecSchema.safeParse({ bgm: "calm", bogus: "no" });
    expect(r.success).toBe(false);
  });
});

describe("parseMixYaml (todo 1)", () => {
  it("parses a YAML string into a MixSpec", () => {
    const yaml = `bgm: calm
sfx:
  scene_2: whoosh
bgm_fade_in_sec: 1.5`;
    const spec = parseMixYaml(yaml);
    expect(spec.bgm).toBe("calm");
    expect(spec.sfx?.scene_2).toBe("whoosh");
    expect(spec.bgm_fade_in_sec).toBe(1.5);
  });

  it("throws when sfx cue keys don't match scene_N pattern", () => {
    const yaml = `bgm: calm
sfx:
  wrong_key: whoosh`;
    expect(() => parseMixYaml(yaml)).toThrow(/Invalid|scene_N/);
  });

  it("throws when YAML is unparseable", () => {
    // The "wrong_key" example above IS valid YAML structurally but fails
    // the schema. For a real YAML parse error (truly malformed), the
    // parser throws — the schema step is never reached. Either path is
    // acceptable; we just want a readable error.
    expect(() => parseMixYaml("not: { valid yaml at all")).toThrow();
  });
});
