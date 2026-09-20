import { describe, expect, it } from "vitest";
import { MockImageProvider, MockVideoProvider } from "./index.js";

describe("MockImageProvider (todo 1) — deterministic PNG bytes from prompt", () => {
  it("returns PNG bytes when given a prompt", async () => {
    const p = new MockImageProvider({ width: 1280, height: 720 });
    const result = await p.generate({
      prompt: "Dark blue background with bold white text 'CoT'",
      width: 1280,
      height: 720,
    });
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.contentType).toBe("image/png");
    expect(result.bytes[0]).toBe(0x89);
    expect(result.bytes[1]).toBe(0x50);
    expect(result.bytes[2]).toBe(0x4e);
    expect(result.bytes[3]).toBe(0x47);
  });

  it("is deterministic for the same prompt (same bytes output)", async () => {
    const p = new MockImageProvider();
    const a = await p.generate({ prompt: "x", width: 256, height: 256 });
    const b = await p.generate({ prompt: "x", width: 256, height: 256 });
    expect(a.bytes).toEqual(b.bytes);
  });

  it("returns different bytes for different prompts (hash-mixed)", async () => {
    const p = new MockImageProvider();
    const a = await p.generate({ prompt: "alpha", width: 256, height: 256 });
    const b = await p.generate({ prompt: "beta", width: 256, height: 256 });
    expect(a.bytes).not.toEqual(b.bytes);
  });
});

describe("MockVideoProvider (todo 1) — placeholder for future AI video", () => {
  it("returns a small mp4 byte payload labeled with the prompt", async () => {
    const p = new MockVideoProvider();
    const result = await p.generate({
      prompt: "60-second Shorts clip about CoT",
      width: 1080,
      height: 1920,
      durationSec: 60,
    });
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.contentType).toBe("video/mp4");
    // Text marker so consumers know this is a placeholder, not real video
    const txt = Buffer.from(result.bytes).toString("utf8");
    expect(txt).toContain("placeholder");
  });
});
