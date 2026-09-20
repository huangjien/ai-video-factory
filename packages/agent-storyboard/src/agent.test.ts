import { describe, expect, it } from "vitest";
import type { ChatResponse, Provider, Usage } from "@vf/llm";
import { callAgent } from "./agent.js";
import { validStoryboardYaml } from "./test-fixtures.js";

class CannedProvider implements Provider {
  readonly name = "minimax";
  readonly responses: string[];
  calls = 0;
  constructor(responses: string[]) {
    this.responses = responses;
  }
  async chat(): Promise<ChatResponse> {
    const content = this.responses[this.calls] ?? "";
    this.calls += 1;
    return {
      content,
      usage: { input: 100, output: 50 } as Usage,
    };
  }
}

const baseInput = {
  topic: "AI 思维链有什么用？",
  audience: "developers",
  duration: 40,
  language: "zh-CN" as const,
  style: "dark-tech",
};

describe("callAgent (todo 4) — §53", () => {
  it("parses a clean VDSL response into a valid Storyboard", async () => {
    const p = new CannedProvider([validStoryboardYaml]);
    const result = await callAgent(baseInput, p);
    expect(result.storyboard.scenes).toHaveLength(2);
    expect(result.usage.input).toBe(100);
    expect(result.usage.output).toBe(50);
  });

  it("strips ```yaml fenced code blocks before parsing", async () => {
    const fenced = "```yaml\n" + validStoryboardYaml + "\n```";
    const p = new CannedProvider([fenced]);
    const result = await callAgent(baseInput, p);
    expect(result.storyboard.scenes).toHaveLength(2);
  });

  it("strips ``` (no language tag) fences", async () => {
    const fenced = "```\n" + validStoryboardYaml + "\n```";
    const p = new CannedProvider([fenced]);
    const result = await callAgent(baseInput, p);
    expect(result.storyboard.scenes).toHaveLength(2);
  });

  it("rejects prose-only response with an AgentError (VDSL validation fails on non-VDSL YAML)", async () => {
    const p = new CannedProvider(["This is not YAML, just a chat reply."]);
    await expect(callAgent(baseInput, p)).rejects.toThrow(/VDSL validation failed/);
  });

  it("rejects empty response with explicit no-YAML message", async () => {
    const p = new CannedProvider([""]);
    await expect(callAgent(baseInput, p)).rejects.toThrow(/no YAML in response/);
  });

  it("rejects invalid VDSL with the underlying validation errors", async () => {
    const invalid = `schema_version: "0.0"
project:
  id: t
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080
scenes: []`;
    const p = new CannedProvider([invalid]);
    await expect(callAgent(baseInput, p)).rejects.toThrow();
  });

  it("sends both system + user messages to the provider", async () => {
    const p = new CannedProvider([validStoryboardYaml]);
    await callAgent(baseInput, p);
    expect(p.calls).toBe(1);
  });
});
