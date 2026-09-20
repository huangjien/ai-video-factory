import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import type { ChatMessage, ChatResponse, Provider } from "@vf/llm";
import { YouTubePackageSchema, callYouTube, YouTubeError } from "./index.js";

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
    return { content, usage: { input: 200, output: 150 } };
  }
}

const goodYaml = `title: "AI 思维链有什么用？"
description: |
  本视频讲解 Chain-of-Thought（CoT）思维链如何提升大模型的推理能力。

  参考资料：
  - https://example.com/sky

  #AI #CoT #LLM
chapters:
  - timestamp: "00:00"
    title: Hook
  - timestamp: "00:05"
    title: Problem
  - timestamp: "00:11"
    title: Explanation
thumbnail_prompt: "Dark blue tech-themed background with bold white text 'CoT'"
shorts_hook: "60 seconds explaining how Chain-of-Thought works"`;

describe("YouTubePackageSchema (todo 1) — §58 Phase 9", () => {
  it("accepts a valid YouTube package", () => {
    const r = YouTubePackageSchema.safeParse(parseYaml(goodYaml));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.title).toContain("思维链");
      expect(r.data.chapters).toHaveLength(3);
      expect(r.data.thumbnail_prompt).toBeDefined();
    }
  });

  it("rejects missing title (strict)", () => {
    const bad = goodYaml.replace("title: \"AI 思维链有什么用？\"\n", "");
    const r = YouTubePackageSchema.safeParse(parseYaml(bad));
    expect(r.success).toBe(false);
  });

  it("rejects extra unknown top-level keys", () => {
    const bad = goodYaml + "\nextra_field: no";
    const r = YouTubePackageSchema.safeParse(parseYaml(bad));
    expect(r.success).toBe(false);
  });

  it("rejects chapter with bad timestamp format", () => {
    const bad = goodYaml.replace('timestamp: "00:00"', 'timestamp: "0:00"');
    const r = YouTubePackageSchema.safeParse(parseYaml(bad));
    expect(r.success).toBe(false);
  });
});

describe("callYouTube (todo 1)", () => {
  it("parses a clean fenced YAML into a YouTubePackage", async () => {
    const p = new CannedProvider(["```yaml\n" + goodYaml + "\n```"]);
    const r = await callYouTube(
      { storyboard: "yaml", script: "md", research: "yaml" },
      p,
    );
    expect(r.youtube.title).toContain("思维链");
    expect(r.youtube.chapters).toHaveLength(3);
    expect(r.usage.output).toBe(150);
  });

  it("rejects missing fenced block with YouTubeError", async () => {
    const p = new CannedProvider(["prose"]);
    await expect(
      callYouTube({ storyboard: "x", script: "x", research: "x" }, p),
    ).rejects.toThrow(YouTubeError);
  });

  it("rejects invalid package schema with YouTubeError", async () => {
    const bad = goodYaml.replace("title: \"AI 思维链有什么用？\"", "title: \"\"");
    const p = new CannedProvider(["```yaml\n" + bad + "\n```"]);
    await expect(
      callYouTube({ storyboard: "x", script: "x", research: "x" }, p),
    ).rejects.toThrow(YouTubeError);
  });
});
