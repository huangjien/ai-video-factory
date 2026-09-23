import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatResponse, Provider } from "@vf/llm";
import { callResearch, ResearchError } from "./agent.js";
import type { WebSearchResult } from "./schemas.js";

class CannedProvider implements Provider {
  readonly name = "minimax";
  readonly responses: string[];
  calls = 0;
  constructor(responses: string[]) {
    this.responses = responses;
  }
  async chat(_req: { messages: ChatMessage[] }): Promise<ChatResponse> {
    const content = this.responses[this.calls] ?? "";
    this.calls += 1;
    return {
      content,
      usage: { input: 200, output: 80 },
    };
  }
}

const goodYaml = `markdown: |
  ## Needs human review
  - c-uncertain
  ## Overview
  Brief.
  ## Key claims
  1. [fact] The sky is blue.
sources:
  - id: s1
    url: https://example.com/sky
    title: Why the sky is blue
    accessed: 2026-09-20
    snippet: Rayleigh scattering.
claims:
  - id: c1
    claim: The sky is blue
    status: fact
    sources: [s1]
  - id: c-uncertain
    claim: Some uncertain claim
    status: uncertain
    sources: [s1]
meta:
  web_search_used: false
  web_search_failed: false
  provider: minimax
  model: MiniMax-M3
`;

describe("callResearch (todo 3) — §55", () => {
  it("parses a clean fenced YAML response", async () => {
    const p = new CannedProvider(["```yaml\n" + goodYaml + "\n```"]);
    const r = await callResearch(
      { topic: "t", audience: "a", language: "zh-CN", duration: 40 },
      p,
      { web: null },
    );
    expect(r.output.claims).toHaveLength(2);
    expect(r.output.meta.provider).toBe("minimax");
  });

  it("rejects missing fenced block with ResearchError", async () => {
    const p = new CannedProvider(["Just some prose, no fence."]);
    await expect(
      callResearch(
        { topic: "t", audience: "a", language: "zh-CN", duration: 40 },
        p,
        { web: null },
      ),
    ).rejects.toThrow(ResearchError);
  });

  it("rejects claim referencing unknown source id with ResearchError", async () => {
    const bad = goodYaml.replace("[s1]", "[s-bogus]");
    const p = new CannedProvider(["```yaml\n" + bad + "\n```"]);
    await expect(
      callResearch(
        { topic: "t", audience: "a", language: "zh-CN", duration: 40 },
        p,
        { web: null },
      ),
    ).rejects.toThrow(/unknown source id s-bogus/);
  });

  it("rejects schema-invalid output (unknown enum)", async () => {
    const bad = goodYaml.replace("status: fact", "status: bogus");
    const p = new CannedProvider(["```yaml\n" + bad + "\n```"]);
    await expect(
      callResearch(
        { topic: "t", audience: "a", language: "zh-CN", duration: 40 },
        p,
        { web: null },
      ),
    ).rejects.toThrow(ResearchError);
  });

  it("falls back gracefully when web search throws — meta.web_search_failed=true", async () => {
    const failingWeb = {
      async search(): Promise<WebSearchResult[]> {
        throw new Error("network down");
      },
    };
    const p = new CannedProvider(["```yaml\n" + goodYaml + "\n```"]);
    const r = await callResearch(
      { topic: "t", audience: "a", language: "zh-CN", duration: 40 },
      p,
      { web: failingWeb },
    );
    expect(r.output.meta.web_search_failed).toBe(true);
    expect(r.output.meta.web_search_used).toBe(false);
  });

  it("uses web search results as webContext when available", async () => {
    const web = {
      async search(): Promise<WebSearchResult[]> {
        return [
          {
            url: "https://example.com/x",
            title: "X",
            snippet: "Important fact X",
          },
        ];
      },
    };
    const p = new CannedProvider(["```yaml\n" + goodYaml + "\n```"]);
    const r = await callResearch(
      { topic: "t", audience: "a", language: "zh-CN", duration: 40 },
      p,
      { web },
    );
    expect(r.output.meta.web_search_used).toBe(true);
    expect(p.calls).toBe(1);
  });
});
