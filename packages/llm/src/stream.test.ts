import { describe, expect, it, vi } from "vitest";
import { chatStream, isHeadersTimeout, stripReasoning } from "./stream.js";

/**
 * The transport is mocked, not the global `fetch`: the provider layer
 * goes through `llmFetch` (packages/llm/src/http.ts), which uses the
 * STANDALONE undici package so the header wait can exceed undici's
 * 300 s default. A test that stubs `global.fetch` would no longer
 * intercept anything.
 */
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, fetch: fetchMock };
});

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
    fetchMock.mockResolvedValue(okResponse(sseStream(events)));
    const r = await chatStream({
      url: "http://x",
      headers: { authorization: "Bearer t" },
      body: { model: "m" },
      timeoutMs: 1_000,
    });
    expect(r.content).toBe("hello world!");
    expect(r.usage).toEqual({ input: 0, output: 0 });
  });

  it("skips the [DONE] sentinel without raising", async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    fetchMock.mockResolvedValue(okResponse(sseStream(events)));
    const r = await chatStream({
      url: "http://x",
      headers: {},
      body: {},
      timeoutMs: 1_000,
    });
    expect(r.content).toBe("x");
  });

  it("captures the final usage chunk", async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"b"}}],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n',
    ];
    fetchMock.mockResolvedValue(okResponse(sseStream(events)));
    const r = await chatStream({
      url: "http://x",
      headers: {},
      body: {},
      timeoutMs: 1_000,
    });
    expect(r.content).toBe("ab");
    expect(r.usage).toEqual({ input: 7, output: 3 });
  });

  it("reports usage 0/0 when the stream never carries a usage frame (the MiniMax no-include_usage gap)", async () => {
    // MiniMax's OpenAI-compatible stream omits usage unless the request
    // asks for it (stream_options.include_usage). The provider adds that
    // flag; THIS test pins the stream-layer semantics of the gap: a
    // usage-less stream yields 0/0, which minimax.ts surfaces as a
    // stderr warning instead of silently writing fabricated numbers
    // into run records.
    const events = [
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    fetchMock.mockResolvedValue(okResponse(sseStream(events)));
    const r = await chatStream({
      url: "http://x",
      headers: {},
      body: {},
      timeoutMs: 1_000,
    });
    expect(r.content).toBe("hello");
    expect(r.usage).toEqual({ input: 0, output: 0 });
  });

  it("tolerates a malformed frame without sinking the response", async () => {
    const events = [
      "this is not valid json\n\n",
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
    ];
    fetchMock.mockResolvedValue(okResponse(sseStream(events)));
    const r = await chatStream({
      url: "http://x",
      headers: {},
      body: {},
      timeoutMs: 1_000,
    });
    expect(r.content).toBe("ok");
  });

  it("sends `Accept: text/event-stream` and `stream: true`", async () => {
    let captured: RequestInit | undefined;
    let url = "";
    fetchMock.mockImplementation(
      async (u: string | URL | Request, init?: RequestInit) => {
        url = String(u);
        captured = init;
        return okResponse(
          sseStream(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n']),
        );
      },
    );
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
    expect((req?.headers as Record<string, string> | undefined)?.["x-k"]).toBe(
      "1",
    );
    const body = JSON.parse(String(req?.body));
    expect(body.stream).toBe(true);
    expect(body.model).toBe("m");
  });

  it("throws with `status` when the server returns a non-2xx", async () => {
    fetchMock.mockResolvedValue(errResponse(503, "down for maintenance"));
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
  });

  it("throws on a body-less 2xx (defends against a misbehaving server)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
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
