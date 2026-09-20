import { describe, expect, it } from "vitest";
import {
  BgmOptionsSchema,
  SfxOptionsSchema,
  AssetResultSchema,
} from "./schemas.js";

describe("BgmOptionsSchema (todo 1)", () => {
  it("accepts a valid BGM request with tag", () => {
    const r = BgmOptionsSchema.safeParse({
      tag: "upbeat-corporate",
      maxDurationSec: 60,
    });
    expect(r.success).toBe(true);
  });

  it("accepts no tag (provider picks default)", () => {
    const r = BgmOptionsSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("rejects negative duration", () => {
    const r = BgmOptionsSchema.safeParse({ maxDurationSec: -1 });
    expect(r.success).toBe(false);
  });
});

describe("SfxOptionsSchema (todo 1)", () => {
  it("accepts a tag for the SFX to look up", () => {
    const r = SfxOptionsSchema.safeParse({ tag: "whoosh", durationSec: 1 });
    expect(r.success).toBe(true);
  });

  it("rejects unknown fields (strict)", () => {
    const r = SfxOptionsSchema.safeParse({ tag: "x", extra: "no" });
    expect(r.success).toBe(false);
  });
});

describe("AssetResultSchema (todo 1)", () => {
  it("accepts bytes+metadata", () => {
    const r = AssetResultSchema.safeParse({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/wav",
      durationSec: 30,
      license: "CC0",
      source: "test-asset",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown content types", () => {
    const r = AssetResultSchema.safeParse({
      bytes: new Uint8Array(),
      contentType: "audio/x-unknown",
      durationSec: 1,
      license: "test",
      source: "test",
    });
    expect(r.success).toBe(false);
  });
});
