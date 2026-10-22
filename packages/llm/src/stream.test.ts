import { describe, expect, it } from "vitest";
import { chatStream, isHeadersTimeout, stripReasoning } from "./stream.js";

describe("isHeadersTimeout", () => {
  it("recognizes the undici code at the top level", () => {
    expect(isHeadersTimeout({ code: "UND_ERR_HEADERS_TIMEOUT" })).toBe(true);
  });

  it("recognizes the code inside .cause", () => {
    expect(
      isHeadersTimeout({
        message: "fetch failed",
        cause: { code: "UND_ERR_HEADERS_TIMEOUT" },
      }),
    ).toBe(true);
  });

  it("recognizes the human message text", () => {
    expect(isHeadersTimeout(new Error("Headers Timeout exceeded"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isHeadersTimeout({ code: "UND_ERR_SOCKET" })).toBe(false);
    expect(isHeadersTimeout(new Error("connect refused"))).toBe(false);
    expect(isHeadersTimeout(null)).toBe(false);
    expect(isHeadersTimeout(undefined)).toBe(false);
    expect(isHeadersTimeout("string error")).toBe(false);
  });
});

/** A Server-Sent-Event byte stream ready to feed to `chatStream`. */
function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
}

function okResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function errResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

describe("chatStream", () => {
  it("assembles content from a sequence of SSE chunks", async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
    ];
    const original = global.fetch;
    global.fetch = (async () => okResponse(sseStream(events))) as typeof fetch;
    try {
      const r = await chatStream({
        url: "http://x",
        headers: { authorization: "Bearer t" },
        body: { model: "m" },
        timeoutMs: 1_000,
      });
      expect(r.content).toBe("hello world!");
      expect(r.usage).toEqual({ input: 0, output: 0 });
    } finally {
      global.fetch = original;
    }
  });

  it("skips the [DONE] sentinel without raising", async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const original = global.fetch;
    global.fetch = (async () => okResponse(sseStream(events))) as typeof fetch;
    try {
      const r = await chatStream({
        url: "http://x",
        headers: {},
        body: {},
        timeoutMs: 1_000,
      });
      expect(r.content).toBe("x");
    } finally {
      global.fetch = original;
    }
  });

  it("captures the final usage chunk", async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"b"}}],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n',
    ];
    const original = global.fetch;
    global.fetch = (async () => okResponse(sseStream(events))) as typeof fetch;
    try {
      const r = await chatStream({
        url: "http://x",
        headers: {},
        body: {},
        timeoutMs: 1_000,
      });
      expect(r.content).toBe("ab");
      expect(r.usage).toEqual({ input: 7, output: 3 });
    } finally {
      global.fetch = original;
    }
  });

  it("tolerates a malformed frame without sinking the response", async () => {
    const events = [
      "this is not valid json\n\n",
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
    ];
    const original = global.fetch;
    global.fetch = (async () => okResponse(sseStream(events))) as typeof fetch;
    try {
      const r = await chatStream({
        url: "http://x",
        headers: {},
        body: {},
        timeoutMs: 1_000,
      });
      expect(r.content).toBe("ok");
    } finally {
      global.fetch = original;
    }
  });

  it("sends `Accept: text/event-stream` and `stream: true`", async () => {
    let captured: RequestInit | undefined;
    let url = "";
    const original = global.fetch;
    global.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u);
      captured = init;
      return okResponse(
        sseStream(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n']),
      );
    }) as typeof fetch;
    try {
      await chatStream({
        url: "http://x",
        headers: { "x-k": "1" },
        body: { model: "m" },
        timeoutMs: 1_000,
      });
      expect(url).toBe("http://x");
      const req = captured as RequestInit | undefined;
      expect((req?.headers as Record<string, string> | undefined)?.Accept).toBe(
        "text/event-stream",
      );
      expect(
        (req?.headers as Record<string, string> | undefined)?.["x-k"],
      ).toBe("1");
      const body = JSON.parse(String(req?.body));
      expect(body.stream).toBe(true);
      expect(body.model).toBe("m");
    } finally {
      global.fetch = original;
    }
  });

  it("throws with `status` when the server returns a non-2xx", async () => {
    const original = global.fetch;
    global.fetch = (async () =>
      errResponse(503, "down for maintenance")) as typeof fetch;
    try {
      const err = await chatStream({
        url: "http://x",
        headers: {},
        body: {},
        timeoutMs: 1_000,
      }).then(
        () => null,
        (e) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect((err as { status?: number }).status).toBe(503);
      expect(String(err?.message).slice(0, 30)).toContain("stream API 503");
    } finally {
      global.fetch = original;
    }
  });

  it("throws on a body-less 2xx (defends against a misbehaving server)", async () => {
    const original = global.fetch;
    global.fetch = (async () =>
      new Response(null, { status: 200 })) as typeof fetch;
    try {
      const err = await chatStream({
        url: "http://x",
        headers: {},
        body: {},
        timeoutMs: 1_000,
      }).then(
        () => null,
        (e) => e,
      );
      expect(String((err as Error).message)).toContain("no body");
    } finally {
      global.fetch = original;
    }
  });
});

describe("stripReasoning", () => {
  it("returns plain text unchanged", () => {
    expect(stripReasoning("just an answer.")).toBe("just an answer.");
  });

  it("strips a <think>…</think> block once", () => {
    expect(stripReasoning("<think>reasoning</think>final answer")).toBe(
      "final answer",
    );
  });

  it("only removes from the LAST opening tag (later thoughts beat earlier)", () => {
    // The doc comment says: when there are multiple, take the last
    // `<think>` as the boundary so the answer is everything after.
    const input = "<think>v1</think>keep<think>v2</think>the answer";
    expect(stripReasoning(input)).toBe("the answer");
  });

  it("drops the rest of the response when <think> is unterminated", () => {
    // A budget-truncated reply has no closing tag — everything after is
    // still reasoning and must not leak into the answer.
    expect(stripReasoning("<think>partial thought, then nothing")).toBe("");
  });

  it("survives bare <think> and </think> fragments", () => {
    expect(stripReasoning("a<think>b</think>c")).toBe("c"); // text before the last <think> is also discarded: the answer is whatever comes after the last closed think block
  });

  it("returns the input if it starts with the answer, not a think block", () => {
    expect(stripReasoning("<think>skipped</think>ok")).toBe("ok");
  });
});
