import { describe, expect, it } from "vitest";
import { loadProviderConfig, withRetry } from "./index.js";
import type { ChatMessage, ChatRequest, ChatResponse, Provider } from "./provider.js";

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
