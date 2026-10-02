import { describe, expect, it } from "vitest";
import { chatWithFallback, loadProviderConfig, withRetry } from "./index.js";
import type {
  ChatError,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  Provider,
} from "./provider.js";

const okResponse = (): ChatResponse => ({
  content: "ok",
  usage: { input: 1, output: 2 },
});

class FakeOkProvider implements Provider {
  readonly name = "fake-ok";
  calls = 0;
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    return okResponse();
  }
}

class FakeFlakyProvider implements Provider {
  readonly name = "fake-flaky";
  calls = 0;
  failFirst = 2;
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    if (this.calls <= this.failFirst) throw new Error("503");
    return okResponse();
  }
}

class Fake4xxProvider implements Provider {
  readonly name = "fake-4xx";
  calls = 0;
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    throw new Error("400");
  }
}

describe("Provider interface (todo 1) — §6 model-agnostic", () => {
  it("accepts any Provider impl that returns ChatResponse", async () => {
    const p = new FakeOkProvider();
    const r = await p.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(r.content).toBe("ok");
    expect(r.usage.input).toBe(1);
    expect(r.usage.output).toBe(2);
  });
});

describe("withRetry (todo 1) — §62.1 retry policy", () => {
  it("retries transient errors up to 3 attempts then throws", async () => {
    const p = new FakeFlakyProvider();
    p.failFirst = 5; // never succeeds in 3 attempts
    await expect(
      withRetry(() => p.chat({ messages: [] }), {
        sleeps: [1, 1, 1],
      }),
    ).rejects.toThrow("503");
    expect(p.calls).toBe(4); // initial + 3 retries
  });

  it("returns on transient success within budget", async () => {
    const p = new FakeFlakyProvider();
    p.failFirst = 2; // succeeds on 3rd try
    const r = await withRetry(() => p.chat({ messages: [] }), {
      sleeps: [1, 1, 1],
    });
    expect(r.content).toBe("ok");
    expect(p.calls).toBe(3);
  });

  it("never retries 4xx (isRetriable=false short-circuits)", async () => {
    const p = new Fake4xxProvider();
    await expect(
      withRetry(() => p.chat({ messages: [] }), {
        sleeps: [1, 1, 1],
        isRetriable: (err) => !String(err).includes("400"),
      }),
    ).rejects.toThrow("400");
    expect(p.calls).toBe(1);
  });

  it("invokes isRetriable per attempt", async () => {
    let retriableCalls = 0;
    const isRetriable = (_err: unknown): boolean => {
      retriableCalls += 1;
      return false;
    };
    const p = new Fake4xxProvider();
    await expect(
      withRetry(() => p.chat({ messages: [] }), {
        sleeps: [1, 1, 1],
        isRetriable,
      }),
    ).rejects.toThrow();
    expect(retriableCalls).toBe(1);
  });
});

describe("loadProviderConfig (todo 1) — §6 per-role primary/fallback", () => {
  it("returns defaults when no config path provided and no env override", () => {
    const cfg = loadProviderConfig();
    expect(cfg.research).toBeDefined();
    expect(cfg.script).toBeDefined();
    expect(cfg.storyboard.primary).toBe("minimax");
    expect(cfg.storyboard.fallback).toBe("glm");
  });

  it("honors LL_CONFIG path pointing at a YAML file", async () => {
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const tmp = path.join(os.tmpdir(), `vf-cfg-${Date.now()}.yaml`);
    await fs.writeFile(
      tmp,
      "storyboard:\n  primary: glm\n  fallback: minimax\n",
      "utf8",
    );
    const cfg = loadProviderConfig(tmp);
    expect(cfg.storyboard.primary).toBe("glm");
    expect(cfg.storyboard.fallback).toBe("minimax");
    await fs.unlink(tmp);
  });
});

describe("ChatMessage shape (todo 1)", () => {
  it("supports system/user/assistant roles", () => {
    const m: ChatMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: "u" },
      { role: "assistant", content: "a" },
    ];
    expect(m).toHaveLength(3);
  });
});

class FakeProvider implements Provider {
  calls = 0;
  private readonly outcome: () => Promise<ChatResponse>;
  constructor(
    readonly name: string,
    outcome: () => ChatResponse,
    private readonly failWith?: Error,
  ) {
    this.outcome = () => Promise.resolve(outcome());
  }
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    if (this.failWith) throw this.failWith;
    return this.outcome();
  }
}

const quotaErr = (provider: string): ChatError => {
  const e = new Error("insufficient_balance") as ChatError;
  e.provider = provider;
  e.status = 429;
  return e;
};
const badReqErr = (provider: string): ChatError => {
  const e = new Error("invalid schema") as ChatError;
  e.provider = provider;
  e.status = 400;
  return e;
};
const transientErr = (provider: string): ChatError => {
  const e = new Error("GLM API 503: upstream unavailable") as ChatError;
  e.provider = provider;
  e.status = 503;
  return e;
};
const missingKeyErr = (provider: string): ChatError => {
  const e = new Error("GLM_API_KEY not set in environment") as ChatError;
  e.provider = provider;
  return e;
};

/** Fails the first `failFirst` attempts with an HTTP 503 ChatError,
 * then succeeds — mimics a transient provider outage. */
class FlakyStatusProvider implements Provider {
  readonly name = "fake-flaky-status";
  calls = 0;
  constructor(private readonly failFirst: number) {}
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    if (this.calls <= this.failFirst) throw transientErr(this.name);
    return okResponse();
  }
}

describe("chatWithFallback (todo 5) — transient retry + fallback", () => {
  const req: ChatRequest = { messages: [{ role: "user", content: "hi" }] };
  const ok = (): ChatResponse => ({
    content: "ok",
    usage: { input: 1, output: 2 },
  });

  it("returns primary's result when primary succeeds", async () => {
    const p = new FakeProvider("glm", ok);
    const f = new FakeProvider("minimax", ok);
    const out = await chatWithFallback(p, f, req);
    expect(out.provider).toBe("glm");
    expect(out.response.content).toBe("ok");
    expect(p.calls).toBe(1);
    expect(f.calls).toBe(0);
  });

  it("falls back on 429 / quota-error", async () => {
    const p = new FakeProvider("glm", ok, quotaErr("glm"));
    const f = new FakeProvider("minimax", ok);
    const out = await chatWithFallback(p, f, req);
    expect(out.provider).toBe("minimax");
    expect(f.calls).toBe(1);
  });

  it("falls back on body_excerpt containing 'quota' / 'balance'", async () => {
    const e = new Error("provider said quota exceeded") as ChatError;
    e.provider = "glm";
    e.body_excerpt = '{"error":"quota_exceeded"}';
    const p = new FakeProvider("glm", ok, e);
    const f = new FakeProvider("minimax", ok);
    const out = await chatWithFallback(p, f, req);
    expect(out.provider).toBe("minimax");
  });

  it("does NOT fall back on a 400 — not retried, not fallback-eligible, surfaces immediately", async () => {
    const p = new FakeProvider("glm", ok, badReqErr("glm"));
    const f = new FakeProvider("minimax", ok);
    await expect(chatWithFallback(p, f, req)).rejects.toThrow(/invalid schema/);
    expect(p.calls).toBe(1); // 4xx is never retried
    expect(f.calls).toBe(0); // 4xx is not a switch-provider signal
  });

  it("retries a transient 503 on the primary, then succeeds without the fallback", async () => {
    const p = new FlakyStatusProvider(1); // fail once, succeed on attempt 2
    const f = new FakeProvider("minimax", ok);
    const out = await chatWithFallback(p, f, req, { sleeps: [1, 1, 1] });
    expect(out.provider).toBe("fake-flaky-status");
    expect(p.calls).toBe(2);
    expect(f.calls).toBe(0);
  });

  it("exhausts transient retries on the primary, then falls back", async () => {
    const p = new FlakyStatusProvider(99); // always 503
    const f = new FakeProvider("minimax", ok);
    const out = await chatWithFallback(p, f, req, { sleeps: [1, 1, 1] });
    expect(out.provider).toBe("minimax");
    expect(p.calls).toBe(4); // initial + 3 retries
    expect(f.calls).toBe(1);
  });

  it("falls back when the primary's API key is missing (no retry)", async () => {
    const p = new FakeProvider("glm", ok, missingKeyErr("glm"));
    const f = new FakeProvider("minimax", ok);
    const out = await chatWithFallback(p, f, req, { sleeps: [1, 1, 1] });
    expect(out.provider).toBe("minimax");
    expect(p.calls).toBe(1); // missing key is not transient — no retry
    expect(f.calls).toBe(1);
  });

  it("strips the model from the fallback request so the fallback uses its own default", async () => {
    const p = new FakeProvider("glm", ok, quotaErr("glm"));
    let seen: ChatRequest | undefined;
    const f: Provider = {
      name: "minimax",
      async chat(r: ChatRequest): Promise<ChatResponse> {
        seen = r;
        return ok();
      },
    };
    const out = await chatWithFallback(
      p,
      f,
      { ...req, model: "MiniMax-M3" },
      { sleeps: [1, 1, 1] },
    );
    expect(out.provider).toBe("minimax");
    expect(seen?.model).toBeUndefined();
    expect(seen?.messages).toEqual(req.messages);
  });

  it("if both fail, surfaces the fallback's error", async () => {
    const p = new FakeProvider("glm", ok, quotaErr("glm"));
    const f = new FakeProvider(
      "minimax",
      ok,
      new Error("minimax also down"),
    );
    await expect(chatWithFallback(p, f, req)).rejects.toThrow(/also down/);
  });

  it("if fallback is null and primary fails with quota error, surfaces the primary's quota error", async () => {
    const p = new FakeProvider("glm", ok, quotaErr("glm"));
    await expect(chatWithFallback(p, null, req)).rejects.toThrow(/insufficient_balance/);
    expect(p.calls).toBe(1);
  });

  it("primary's usage stats are NOT counted when fallback served the request", async () => {
    const p = new FakeProvider("glm", ok, quotaErr("glm"));
    const f = new FakeProvider("minimax", () => ({
      content: "fallback",
      usage: { input: 5, output: 10 },
    }));
    const out = await chatWithFallback(p, f, req);
    expect(p.calls).toBe(1);
    expect(f.calls).toBe(1);
    expect(out.response.usage.input).toBe(5);
  });
});
