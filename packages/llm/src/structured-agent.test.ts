import { describe, expect, it } from "vitest";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  Provider,
} from "./provider.js";
import {
  callStructured,
  extractBalancedJson,
  extractJsonObject,
  extractReplyBody,
  structuredYamlParser,
} from "./structured-agent.js";

/** A provider that answers with whatever it is handed, in order. */
function canned(
  replies: string[],
  name = "fake",
): Provider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    name,
    calls,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      calls.push(req);
      const content = replies[calls.length - 1] ?? "";
      return { content, usage: { input: 10, output: 5 } };
    },
  };
}

const PROMPT: ChatMessage[] = [
  { role: "system", content: "SYS" },
  { role: "user", content: "USR" },
];

describe("callStructured — the one call loop", () => {
  it("returns the answer, the usage, and the provider that served it", async () => {
    const p = canned(["ok"]);
    const r = await callStructured({
      messages: PROMPT,
      provider: p,
      parse: (content) => content,
    });
    expect(r.data).toBe("ok");
    expect(r.usage).toEqual({ input: 10, output: 5 });
    expect(r.providerName).toBe("fake");
    expect(r.attempts).toBe(1);
    expect(r.messages).toEqual(PROMPT);
  });

  it("asks again when the agent says how, and accumulates the usage", async () => {
    const p = canned(["bad", "good"]);
    const r = await callStructured({
      messages: PROMPT,
      provider: p,
      attempts: 2,
      parse: (content) => {
        if (content !== "good") throw new Error("unusable");
        return content;
      },
      nextAttempt: () => ({
        messages: [...PROMPT, { role: "user", content: "again" }],
      }),
    });
    expect(r.data).toBe("good");
    expect(r.attempts).toBe(2);
    expect(r.usage).toEqual({ input: 20, output: 10 });
    expect(p.calls).toHaveLength(2);
    // The second call carried the repair scaffolding...
    expect(p.calls[1]?.messages).toHaveLength(3);
    // ...but the RESULT still describes the original prompt, so a
    // run-record's prompt_hash never hashes the repair.
    expect(r.messages).toEqual(PROMPT);
  });

  it("gives up when the agent has no way to ask again", async () => {
    const p = canned(["bad"]);
    await expect(
      callStructured({
        messages: PROMPT,
        provider: p,
        attempts: 3,
        parse: () => {
          throw new Error("unusable");
        },
        nextAttempt: () => null,
      }),
    ).rejects.toThrow(/unusable/);
    expect(p.calls).toHaveLength(1);
  });

  it("hands every failure to onFailure, first error first", async () => {
    const p = canned(["one", "two"]);
    const seen: string[] = [];
    await expect(
      callStructured({
        messages: PROMPT,
        provider: p,
        attempts: 2,
        parse: (content) => {
          throw new Error(content);
        },
        nextAttempt: () => ({ messages: PROMPT }),
        onFailure: (errors) => {
          for (const e of errors) seen.push(e.message);
          return new Error(`failed after ${errors.length}`);
        },
      }),
    ).rejects.toThrow(/failed after 2/);
    expect(seen).toEqual(["one", "two"]);
  });

  it("lets the agent report the FIRST failure instead of the last", async () => {
    const p = canned(["one", "two"]);
    await expect(
      callStructured({
        messages: PROMPT,
        provider: p,
        attempts: 2,
        parse: (content) => {
          throw new Error(content);
        },
        nextAttempt: () => ({ messages: PROMPT }),
        onFailure: (errors) => errors[0]!,
      }),
    ).rejects.toThrow(/one/);
  });

  it("never offers a retry for a provider outage", async () => {
    const down: Provider = {
      name: "down",
      async chat(): Promise<ChatResponse> {
        throw new Error("provider is down");
      },
    };
    let asked = false;
    await expect(
      callStructured({
        messages: PROMPT,
        provider: down,
        attempts: 2,
        parse: () => "never",
        nextAttempt: () => {
          asked = true;
          return { messages: PROMPT };
        },
      }),
    ).rejects.toThrow(/provider is down/);
    expect(asked).toBe(false);
  });

  it("asks the provider the agent names, and owns its failover", async () => {
    const primary = canned(["bad"], "primary");
    const other = canned(["good"], "other");
    const r = await callStructured({
      messages: PROMPT,
      provider: primary,
      attempts: 2,
      parse: (content) => {
        if (content !== "good") throw new Error("unusable");
        return content;
      },
      nextAttempt: () => ({ messages: PROMPT, provider: other }),
    });
    expect(r.data).toBe("good");
    expect(r.providerName).toBe("other");
    expect(primary.calls).toHaveLength(1);
    expect(other.calls).toHaveLength(1);
  });
});

describe("the extractors — a model's sketch is never the answer", () => {
  it("strips the reasoning before looking for the answer", () => {
    const raw = '<think>{"sketch": true}</think>\n```json\n{"answer": 1}\n```';
    expect(extractBalancedJson(raw)).toBe('{"answer": 1}');
    expect(extractJsonObject(raw)).toBe('{"answer": 1}');
    expect(extractReplyBody(raw)).toBe('{"answer": 1}');
  });

  it("finds a JSON object inside prose", () => {
    expect(extractJsonObject('sure:\n{"a": 1}\nthanks')).toBe('{"a": 1}');
    expect(extractJsonObject("no json here")).toBeNull();
  });

  it("keeps a JSON string with braces inside it intact", () => {
    expect(extractBalancedJson('{"a": "}{"}')).toBe('{"a": "}{"}');
    expect(extractBalancedJson('{"a": 1')).toBeNull();
  });

  it("unwraps a single wrapping fence", () => {
    expect(extractReplyBody('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(extractReplyBody("```yaml\na: 1\n```")).toBe("a: 1");
  });
});

describe("structuredYamlParser — the schema path as a parser", () => {
  const schema = {
    safeParse(input: unknown) {
      if (typeof input !== "object" || input === null || !("a" in input)) {
        return {
          success: false as const,
          error: { issues: [{ path: ["a"], message: "required" }] },
        };
      }
      return { success: true as const, data: input };
    },
  };

  it("reads the answer and throws through the agent's error class", () => {
    const parse = structuredYamlParser({
      schema,
      schemaLabel: "Thing schema",
      toError: (message, providerName) =>
        new Error(`${providerName}: ${message}`),
    });
    expect(parse("a: 1", "fake")).toEqual({ a: 1 });
    expect(() => parse("b: 1", "fake")).toThrow(/fake: Thing schema invalid/);
  });
});
