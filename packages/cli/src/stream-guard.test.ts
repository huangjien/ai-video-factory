import { describe, expect, it } from "vitest";
import { installStreamGuard, isTransientStreamNoise } from "./stream-guard.js";

/**
 * 2026-10-24 (ai-era-software-engineering-11-shifts): a long GLM draft
 * died mid-run on an undici http2 stream tearing down after a connection
 * reset — the stray `error` event crashed the process even though the
 * fetch promise's rejection was already flowing into the bounded retry.
 * The guard absorbs ONLY this noise class; anything else rethrows.
 */
describe("isTransientStreamNoise", () => {
  it("absorbs the undici h2 teardown signature", () => {
    const err = new TypeError("terminated");
    Object.assign(err, { code: "ECONNRESET" });
    expect(isTransientStreamNoise(err)).toBe(true);
  });

  it("absorbs an http2 stream error with no message", () => {
    const err = new Error("socket hang up");
    Object.assign(err, { code: "ERR_HTTP2_STREAM_ERROR" });
    expect(isTransientStreamNoise(err)).toBe(true);
  });

  it("absorbs a bare ECONNRESET cause", () => {
    const err = new TypeError("fetch failed");
    Object.assign(err, {
      cause: Object.assign(new Error("x"), { code: "ECONNRESET" }),
    });
    expect(isTransientStreamNoise(err)).toBe(true);
  });

  it("does NOT absorb real bugs (undefined variable, type errors)", () => {
    expect(
      isTransientStreamNoise(
        new TypeError("Cannot read properties of undefined (reading 'map')"),
      ),
    ).toBe(false);
    expect(
      isTransientStreamNoise(new Error("storyboard is not approved")),
    ).toBe(false);
    expect(isTransientStreamNoise("a string rejection")).toBe(false);
    expect(isTransientStreamNoise(null)).toBe(false);
  });

  it("installStreamGuard: absorbs noise rejections, rethrows real ones", () => {
    installStreamGuard(); // idempotent
    installStreamGuard();
    const noise = new TypeError("terminated");
    Object.assign(noise, { code: "ECONNRESET" });
    // Emitting through process must NOT throw for noise…
    expect(() => process.emit("unhandledRejection", noise)).not.toThrow();
    // …and MUST rethrow for real bugs (a handler-level throw surfaces to
    // the runtime's own fatal path).
    const realBug = new TypeError(
      "Cannot read properties of undefined (reading 'map')",
    );
    expect(() => process.emit("unhandledRejection", realBug)).toThrow();
  });
});
