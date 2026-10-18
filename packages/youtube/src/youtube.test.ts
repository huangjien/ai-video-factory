import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import type { ChatMessage, ChatResponse, Provider } from "@video/llm";
import {
  YouTubePackageSchema,
  buildYouTubeMessages,
  callYouTube,
  YouTubeError,
  hasTextOverlay,
} from "./index.js";

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
thumbnail_prompt: "Young woman · eyes wide with surprise · cozy kitchen at dawn · warm side-light · curious and hopeful · 35mm cinematic"
shorts_hook: "A person leans toward camera · reveals the surprise with a clear voice · kitchen morning light · curious hopeful tone"`;

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
    const bad = goodYaml.replace('title: "AI 思维链有什么用？"\n', "");
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
    const bad = goodYaml.replace('title: "AI 思维链有什么用？"', 'title: ""');
    const p = new CannedProvider(["```yaml\n" + bad + "\n```"]);
    await expect(
      callYouTube({ storyboard: "x", script: "x", research: "x" }, p),
    ).rejects.toThrow(YouTubeError);
  });
});

describe("hasTextOverlay (T4 validator)", () => {
  it("returns false for clean visual scene prompts", () => {
    expect(
      hasTextOverlay(
        "Young woman · eyes wide with surprise · cozy kitchen at dawn · warm side-light · 35mm cinematic",
      ),
    ).toBe(false);
  });
  it("flags prompts that mention text / subtitles / logos", () => {
    expect(
      hasTextOverlay(
        "A bold text overlay reading 'Hello' on a dark background",
      ),
    ).toBe(true);
    expect(hasTextOverlay("A subtitle beneath a person")).toBe(true);
    expect(hasTextOverlay("A logo in the corner")).toBe(true);
  });
  it("flags zh-CN banned tokens", () => {
    expect(hasTextOverlay("白色粗体大字「AI 思维链」在深色背景")).toBe(true);
    expect(hasTextOverlay("海报风格设计")).toBe(true);
    expect(hasTextOverlay("界面 仪表盘")).toBe(true);
  });
  it("allows the compliant 'no text' constraint the template mandates", () => {
    expect(
      hasTextOverlay(
        "Two engineers at a whiteboard · medium shot · warm side-light · no text, no letters, no logos · the right third stays quiet for the title",
      ),
    ).toBe(false);
    expect(hasTextOverlay("A matte concrete texture under soft light")).toBe(
      false,
    );
    expect(hasTextOverlay("Close-up in an office, out of context")).toBe(false);
  });
  it("allows the zh negation the template mandates (live 2026-10-18)", () => {
    expect(
      hasTextOverlay(
        "年轻的女工程师 · 站在米白墙前 · 右侧留白留给后期排印标题 · 编辑部风格插画，全画面无任何文字、字母、数字、标志或水印",
      ),
    ).toBe(false);
    expect(hasTextOverlay("年轻女工程师站在墙前，字幕压在下方")).toBe(true);
  });
});

describe("callYouTube text-overlay retry path (T4)", () => {
  it("throws YouTubeError when thumbnail_prompt contains banned tokens", async () => {
    const badYaml = goodYaml.replace(
      'thumbnail_prompt: "Young woman',
      "thumbnail_prompt: \"Bold white text 'CoT' centered on dark background with subtitle",
    );
    const p = new CannedProvider(["```yaml\n" + badYaml + "\n```"]);
    await expect(
      callYouTube({ storyboard: "x", script: "x", research: "x" }, p),
    ).rejects.toThrow(/banned tokens/);
  });
});

// v0.10.3: the thumbnail inherits the video's visual identity. A video
// rendered as editorial illustration was getting a "cinematic 35mm"
// thumbnail — the shop window selling a different product than the shop.
describe("buildYouTubeMessages — visual identity", () => {
  const base = {
    storyboard: "sb",
    script: "sc",
    research: "rs",
  };

  it("carries the style preset and setting as the FIRST user block", () => {
    // First on purpose: the agent must not invent a [style modifier] before
    // the video's own identity has arrived.
    const user =
      buildYouTubeMessages({
        ...base,
        imageStyle: "editorial",
        setting: "Tang-dynasty China, 626-630 CE",
      })[1]?.content ?? "";
    expect(user).toContain("## Visual identity");
    expect(user).toContain("Style preset: editorial");
    expect(user).toContain(
      "Setting (era / region / culture): Tang-dynasty China",
    );
    expect(user.indexOf("## Visual identity")).toBeLessThan(
      user.indexOf("## Hook") === -1 ? user.length : user.indexOf("## Hook"),
    );
    expect(user.indexOf("## Visual identity")).toBe(0);
  });

  it("includes only what is declared", () => {
    const user =
      buildYouTubeMessages({ ...base, imageStyle: "ink-wash" })[1]?.content ??
      "";
    expect(user).toContain("Style preset: ink-wash");
    expect(user).not.toContain("Setting (era / region / culture)");
  });

  it("omits the block entirely when neither is declared (back-compat)", () => {
    const user = buildYouTubeMessages(base)[1]?.content ?? "";
    expect(user).not.toContain("## Visual identity");
  });

  it("the system prompt forbids inventing a style and demands era anchoring", () => {
    const system = buildYouTubeMessages(base)[0]?.content ?? "";
    expect(system).toContain("MATCH THE VIDEO'S VISUAL IDENTITY");
    expect(system).toMatch(/never a different\s+one/);
    expect(system).toMatch(/Never leave a historical thumbnail unanchored/);
    expect(system).toContain("THE VIDEO'S STYLE PRESET (not invented)");
  });
});
