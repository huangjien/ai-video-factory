import { describe, expect, it } from "vitest";
import { afterAll, beforeAll } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { GLMProvider } from "@vf/llm";
import { callDraft, DraftError } from "./agent.js";

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
      { topic: "AI 思维链", audience: "developers", language: "zh-CN", duration: 40 },
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
      { topic: "AI chain of thought", audience: "developers", language: "en-US", duration: 40 },
      p,
    );
    expect(markdown).toContain("voice: en-US-ChristopherNeural");
  });

  it("falls back to defaults when LLM omits fields", async () => {
    const partial = {
      title: "Topic",
      scenes: [{ id: "scene_1", duration: 40, caption: "x", visual: "y", narration: "z" }],
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
