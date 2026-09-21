import { describe, expect, it } from "vitest";
import { TTSError } from "./provider.js";

describe("TTSError (provider.ts smoke)", () => {
  it("carries provider name + optional status", () => {
    const err = new TTSError("synthesis failed", "edge", 429);
    expect(err.name).toBe("TTSError");
    expect(err.message).toBe("synthesis failed");
    expect(err.providerName).toBe("edge");
    expect(err.status).toBe(429);
  });

  it("works without a status", () => {
    const err = new TTSError("no key", "edge");
    expect(err.status).toBeUndefined();
    expect(err instanceof Error).toBe(true);
  });
});
