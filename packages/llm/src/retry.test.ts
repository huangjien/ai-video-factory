import { describe, expect, it } from "vitest";
import { chatWithFallback, withRetry } from "./index.js";
import type {
  ChatError,
  ChatRequest,
  ChatResponse,
  Provider,
  ProviderTelemetry,
} from "./provider.js";

/** A provider whose failed attempts report what they burned on the wire.
 *  The failed attempt is the one that costs money and time — it must
 *  not vanish when the error is thrown. */
class BurningProvider implements Provider {
  readonly name = "burning";
  calls = 0;
  constructor(
    private readonly failFirst: number,
    private readonly failure: ProviderTelemetry = {
      requests: 1,
      streams: 0,
      headersTimeoutRetries: 0,
      reasoningTokens: 0,
      durationMs: 300_000,
    },
  ) {}
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    if (this.calls <= this.failFirst) {
      const err = new Error("503") as ChatError;
      err.provider = this.name;
      err.status = 503;
      err.telemetry = { ...this.failure };
      throw err;
    }
    return {
      content: "ok",
      usage: { input: 1, output: 2 },
      telemetry: {
        requests: 1,
        streams: 0,
        headersTimeoutRetries: 0,
        reasoningTokens: 0,
        durationMs: 1_000,
      },
    };
  }
}

/** A provider that reports nothing — a mock must keep its shape. */
class SilentProvider implements Provider {
  readonly name = "silent";
  calls = 0;
  constructor(private readonly failFirst: number) {}
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    if (this.calls <= this.failFirst) throw new Error("503");
    return { content: "ok", usage: { input: 1, output: 2 } };
  }
}

describe("withRetry — the cost of a discarded attempt", () => {
  it("carries the failed attempts' requests into the surviving response", async () => {
    const p = new BurningProvider(2);
    const r = await withRetry(() => p.chat({ messages: [] }), {
      sleeps: [1, 1, 1],
    });
    // Two discarded attempts + the one that answered.
    expect(r.telemetry?.requests).toBe(3);
    expect(r.telemetry?.durationMs).toBe(2 * 300_000 + 1_000);
  });

  it("counts a discarded header-timeout request as a discarded request", async () => {
    const p = new BurningProvider(1, {
      requests: 2,
      streams: 1,
      headersTimeoutRetries: 1,
      reasoningTokens: 0,
      durationMs: 300_100,
    });
    const r = await withRetry(() => p.chat({ messages: [] }), {
      sleeps: [1, 1, 1],
    });
    expect(r.telemetry?.requests).toBe(3);
    expect(r.telemetry?.streams).toBe(1);
    expect(r.telemetry?.headersTimeoutRetries).toBe(1);
  });

  it("hands the accumulated cost to the failure when every attempt fails", async () => {
    const p = new BurningProvider(99);
    const err = await withRetry(() => p.chat({ messages: [] }), {
      sleeps: [1, 1, 1],
    }).catch((e) => e as ChatError);
    // initial + 3 retries — every discarded request is on the error
    expect(err.telemetry?.requests).toBe(4);
    expect(err.telemetry?.durationMs).toBe(4 * 300_000);
  });

  it("leaves a response without telemetry untouched", async () => {
    const p = new SilentProvider(1);
    const r = await withRetry(() => p.chat({ messages: [] }), {
      sleeps: [1, 1, 1],
    });
    expect(r.telemetry).toBeUndefined();
  });
});

describe("chatWithFallback — the primary's burnt requests", () => {
  it("adds the primary's discarded cost to the fallback's response", async () => {
    const primary = new BurningProvider(99);
    const fallback = new BurningProvider(0);
    const out = await chatWithFallback(
      primary,
      fallback,
      { messages: [] },
      {
        sleeps: [1, 1, 1],
      },
    );
    expect(out.failover).toBe(true);
    // The primary's four discarded attempts + the fallback's own request.
    expect(out.response.telemetry?.requests).toBe(5);
  });

  it("reports a failover so a long call has an explanation", async () => {
    const primary = new BurningProvider(99);
    const fallback = new BurningProvider(0);
    const out = await chatWithFallback(
      primary,
      fallback,
      { messages: [] },
      {
        sleeps: [1, 1, 1],
      },
    );
    expect(out.provider).toBe("burning");
    expect(out.failover).toBe(true);
  });
});
