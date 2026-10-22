import { describe, expect, it } from "vitest";
import { afterAll, beforeAll } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { GLMProvider } from "@video/llm";
import { callDraft, DraftError, extractBalancedJson } from "./agent.js";

function listen(server: Server): Promise<{ url: string; port: number }> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${addr.port}`, port: addr.port });
    });
  });
}

describe("callDraft (JSON-mode assembly)", () => {
  let server: Server;
  let baseUrl: string;
  let responseBody = "";

  beforeAll(async () => {
    server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(responseBody);
    });
    const l = await listen(server);
    baseUrl = l.url;
    process.env["GLM_API_KEY"] = "test-key";
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  const validJson = {
    title: "AI 思维链",
    hook: "在 AI 时代，理解思维链比学 API 更重要。",
    sections: [
      { heading: "问题", body: "大模型怎么思考？" },
      { heading: "解释", body: "分步骤思考的技术。" },
    ],
    scenes: [
      {
        id: "scene_1",
        duration: 20,
        caption: "问题",
        visual: "图标",
        narration: "在 AI 时代\n思维链很关键",
      },
      {
        id: "scene_2",
        duration: 20,
        caption: "结论",
        visual: "结尾",
        narration: "试试看",
      },
    ],
  };

  it("assembles article.md from JSON LLM output", async () => {
    responseBody = JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validJson) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
    const p = new GLMProvider({ baseUrl });
    const { markdown } = await callDraft(
      {
        topic: "AI 思维链",
        audience: "developers",
        language: "zh-CN",
        duration: 40,
      },
      p,
    );
    expect(markdown.startsWith("---\n")).toBe(true);
    expect(markdown).toContain("language: zh-CN");
    expect(markdown).toContain("voice: zh-CN-YunjianNeural");
    expect(markdown).toContain("# AI 思维链");
    expect(markdown).toContain("> **Hook**");
    expect(markdown).toContain("## 1. 问题");
    expect(markdown).toContain("## Scenes");
    expect(markdown).toContain("```yaml");
    expect(markdown).toContain("scene_1");
    expect(markdown).toContain("在 AI 时代");
  });

  it("uses English voice for en-US projects", async () => {
    responseBody = JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validJson) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
    const p = new GLMProvider({ baseUrl });
    const { markdown } = await callDraft(
      {
        topic: "AI chain of thought",
        audience: "developers",
        language: "en-US",
        duration: 40,
      },
      p,
    );
    expect(markdown).toContain("voice: en-US-ChristopherNeural");
  });

  it("falls back to defaults when LLM omits fields", async () => {
    const partial = {
      title: "Topic",
      scenes: [
        {
          id: "scene_1",
          duration: 40,
          caption: "x",
          visual: "y",
          narration: "z",
        },
      ],
    };
    responseBody = JSON.stringify({
      choices: [{ message: { content: JSON.stringify(partial) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const p = new GLMProvider({ baseUrl });
    const { markdown } = await callDraft(
      { topic: "Topic", audience: "a", language: "zh-CN", duration: 40 },
      p,
    );
    expect(markdown).toContain("# Topic");
    expect(markdown).toContain("> **Hook**");
    expect(markdown).toContain("(待编辑");
  });

  it("throws DraftError on empty response", async () => {
    responseBody = JSON.stringify({
      choices: [{ message: { content: "" } }],
      usage: { prompt_tokens: 1, completion_tokens: 0 },
    });
    const p = new GLMProvider({ baseUrl });
    await expect(
      callDraft(
        { topic: "t", audience: "a", language: "zh-CN", duration: 40 },
        p,
      ),
    ).rejects.toThrow(DraftError);
  });

  it("throws DraftError on invalid JSON", async () => {
    responseBody = JSON.stringify({
      choices: [{ message: { content: "{not valid json" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const p = new GLMProvider({ baseUrl });
    await expect(
      callDraft(
        { topic: "t", audience: "a", language: "zh-CN", duration: 40 },
        p,
      ),
    ).rejects.toThrow(/JSON parse failed/);
  });
});

/** Inline fake Provider — no HTTP, full control over response sequencing. */
function fakeProvider(respond: () => string): import("@video/llm").Provider & {
  calls: number;
} {
  return {
    name: "fake",
    calls: 0,
    async chat(req: import("@video/llm").ChatRequest) {
      this.calls++;
      void req;
      return { content: respond(), usage: { input: 1, output: 1 } };
    },
  };
}

const DRAFT_INPUT = {
  topic: "t",
  audience: "a",
  language: "zh-CN" as const,
  duration: 40,
};

describe("extractBalancedJson", () => {
  it("extracts the object out of surrounding prose", () => {
    expect(extractBalancedJson('sure! {"a":1} hope this helps')).toBe(
      '{"a":1}',
    );
  });

  it("handles nesting", () => {
    expect(extractBalancedJson('x {"a":{"b":{"c":1}}} y')).toBe(
      '{"a":{"b":{"c":1}}}',
    );
  });

  it("ignores braces inside strings and escape sequences", () => {
    expect(extractBalancedJson('{"a":"has } and { and \\" quotes"}')).toBe(
      '{"a":"has } and { and \\" quotes"}',
    );
  });

  it("returns the FIRST balanced object when several exist", () => {
    expect(extractBalancedJson('{"a":1} then {"b":2}')).toBe('{"a":1}');
  });

  it("returns null when there is no object", () => {
    expect(extractBalancedJson("no braces at all")).toBeNull();
    expect(extractBalancedJson("} lone closer {")).toBeNull();
  });
});

describe("callDraft — tolerant parsing + retry", () => {
  const validArticleJson = JSON.stringify({
    title: "T",
    hook: "H",
    sections: [{ heading: "s", body: "b" }],
    scenes: [
      { id: "scene_1", duration: 5, caption: "c", visual: "v", narration: "n" },
    ],
  });

  it("accepts a fenced JSON response on the first pass (no retry)", async () => {
    const p = fakeProvider(() => "```json\n" + validArticleJson + "\n```");
    const r = await callDraft(DRAFT_INPUT, p);
    expect(r.markdown).toContain("# T");
    expect(p.calls).toBe(1);
  });

  it("accepts JSON embedded in prose via the balanced extractor", async () => {
    const p = fakeProvider(
      () => `Here is your article:\n${validArticleJson}\nDone!`,
    );
    const r = await callDraft(DRAFT_INPUT, p);
    expect(r.markdown).toContain("## Scenes");
    expect(p.calls).toBe(1);
  });

  it("retries once with the JSON-only reminder when prose has no JSON", async () => {
    let n = 0;
    const p = {
      name: "fake",
      calls: 0,
      async chat(req: import("@video/llm").ChatRequest) {
        this.calls++;
        if (++n === 1)
          return {
            content: "I will write a great article about it.",
            usage: { input: 1, output: 1 },
          };
        expect(req.messages.at(-1)?.content).toContain("not valid JSON");
        return { content: validArticleJson, usage: { input: 1, output: 1 } };
      },
    };
    const r = await callDraft(DRAFT_INPUT, p);
    expect(r.markdown).toContain("# T");
    expect(p.calls).toBe(2);
  });

  it("throws DraftError when both attempts are unparseable", async () => {
    const p = fakeProvider(() => "just words, no structure");
    await expect(callDraft(DRAFT_INPUT, p)).rejects.toThrow(DraftError);
    expect(p.calls).toBe(2);
  });

  it("propagates the empty-response failure as DraftError", async () => {
    const p = fakeProvider(() => "");
    await expect(callDraft(DRAFT_INPUT, p)).rejects.toThrow(DraftError);
  });
});

describe("callDraft — provider fallback routing", () => {
  const okArticle = () =>
    JSON.stringify({
      title: "T",
      hook: "H",
      sections: [],
      scenes: [
        {
          id: "scene_1",
          duration: 5,
          caption: "c",
          visual: "v",
          narration: "n",
        },
      ],
    });

  it("serves via the fallback when the primary hits a quota error", async () => {
    const primary = {
      name: "primary-fake",
      calls: 0,
      async chat() {
        this.calls++;
        throw Object.assign(new Error("insufficient balance"), { status: 429 });
      },
    };
    const fallback = {
      name: "fallback-fake",
      calls: 0,
      async chat() {
        this.calls++;
        return { content: okArticle(), usage: { input: 2, output: 3 } };
      },
    };
    const r = await callDraft(DRAFT_INPUT, primary, fallback);
    expect(r.providerName).toBe("fallback-fake");
    expect(r.markdown).toContain("# T");
    expect(primary.calls).toBe(1);
    expect(fallback.calls).toBe(1);
  });

  it("surfaces a 400 immediately without consulting the fallback", async () => {
    const primary = {
      name: "primary-fake",
      async chat() {
        throw Object.assign(new Error("bad request"), { status: 400 });
      },
    };
    const fallback = {
      name: "fallback-fake",
      calls: 0,
      async chat() {
        this.calls++;
        return { content: okArticle(), usage: { input: 1, output: 1 } };
      },
    };
    await expect(callDraft(DRAFT_INPUT, primary, fallback)).rejects.toThrow(
      /bad request/,
    );
    expect(fallback.calls).toBe(0);
  });
});

describe("callDraft — markdown assembly edges", () => {
  const viaCall = (json: Record<string, unknown>) => {
    const provider = fakeProvider(() => JSON.stringify(json));
    return callDraft(DRAFT_INPUT, provider);
  };

  it("JSON-escapes captions containing YAML-hostile characters", async () => {
    const r = await viaCall({
      title: "T",
      hook: "H",
      scenes: [
        {
          id: "scene_1",
          duration: 5,
          caption: "key: value #hash",
          visual: "v",
          narration: "n",
        },
      ],
    });
    expect(r.markdown).toContain('caption: "key: value #hash"');
  });

  it("keeps CJK topic characters in the project slug", async () => {
    const provider = fakeProvider(() =>
      JSON.stringify({ title: "T", hook: "H", scenes: [] }),
    );
    const r = await callDraft(
      { ...DRAFT_INPUT, topic: "思维链演示" },
      provider,
    );
    expect(r.markdown).toContain("project: 思维链演示");
  });

  it("truncates a very long topic slug to 40 chars", async () => {
    const provider = fakeProvider(() =>
      JSON.stringify({ title: "T", hook: "H", scenes: [] }),
    );
    const r = await callDraft(
      { ...DRAFT_INPUT, topic: "a".repeat(80) },
      provider,
    );
    const m = r.markdown.match(/^project: (.+)$/m);
    expect(m?.[1]?.length).toBeLessThanOrEqual(40);
  });

  it("renders a placeholder heading for sections missing one", async () => {
    const r = await viaCall({
      title: "T",
      hook: "H",
      sections: [{ body: "only body" }],
      scenes: [],
    });
    expect(r.markdown).toContain("## 1. (待编辑)");
    expect(r.markdown).toContain("only body");
  });
});

describe("agent edges", () => {
  it("extractBalancedJson returns null for an unterminated object", () => {
    expect(extractBalancedJson('{"a": {"b": 1}')).toBeNull();
  });

  it("keeps multi-line narrations as an indented block scalar", async () => {
    const provider = fakeProvider(() =>
      JSON.stringify({
        title: "T",
        hook: "H",
        sections: [],
        scenes: [
          {
            id: "scene_1",
            duration: 5,
            caption: "c",
            visual: "v",
            narration: "第一行\n第二行",
          },
        ],
      }),
    );
    const r = await callDraft(DRAFT_INPUT, provider);
    expect(r.markdown).toContain("    narration: |");
    expect(r.markdown).toContain("      第一行");
    expect(r.markdown).toContain("      第二行");
  });
});
