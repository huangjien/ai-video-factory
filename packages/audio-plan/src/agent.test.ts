import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";
import { parseArticle, type ParsedArticle } from "@video/draft";
import {
  AudioPlanError,
  callAudioPlan,
  renderAudioConfig,
} from "./agent.js";

function fakeProvider(content: string): Provider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    name: "fake",
    calls,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      calls.push(req);
      return { content, usage: { input: 3, output: 5 } };
    },
  };
}

const ARTICLE_MD = `---
project: ap-agent
language: zh-CN
duration_target_sec: 10
voice: zh-CN-YunjianNeural
---

# 标题

> **Hook** (≤10s): h。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 5
    caption: 一
    visual: 图标
    narration: 旁白。
\`\`\`
`;

const INPUT = (article: ParsedArticle = parseArticle(ARTICLE_MD)) => ({
  article,
  language: "zh-CN" as const,
});

describe("renderAudioConfig", () => {
  it("renders the stable key order with sorted sfx entries", () => {
    const yaml = renderAudioConfig({
      voice: "v1",
      bgm: "calm",
      bgm_fade_in_sec: 1,
      bgm_fade_out_sec: 2,
      pause_between_sentences_sec: 0,
      sfx: { scene_2: "ding", scene_1: "whoosh" },
    });
    const lines = yaml.split("\n");
    const at = (prefix: string): number =>
      lines.findIndex((l) => l.startsWith(prefix));
    expect(lines[0]).toBe("voice: v1");
    expect(lines[1]).toBe('bgm: "calm"');
    expect(at("sfx:")).toBeLessThan(at("  scene_1:"));
    expect(at("  scene_1:")).toBeLessThan(at("  scene_2:"));
  });

  it("renders null bgm and an empty sfx map explicitly", () => {
    const yaml = renderAudioConfig({
      bgm: null,
      bgm_fade_in_sec: 1.5,
      bgm_fade_out_sec: 2,
      sfx: {},
    });
    expect(yaml).toContain("bgm: null");
    expect(yaml).toContain("sfx: {}");
  });

  it("omits pause_between_sentences_sec when zero", () => {
    const yaml = renderAudioConfig({
      bgm: "x",
      bgm_fade_in_sec: 1,
      bgm_fade_out_sec: 2,
      pause_between_sentences_sec: 0,
      sfx: {},
    });
    expect(yaml).not.toContain("pause_between_sentences_sec");
  });
});

describe("callAudioPlan — tolerant parsing", () => {
  it("parses a plain JSON response and merges defaults", async () => {
    const r = await callAudioPlan(
      INPUT(),
      fakeProvider(JSON.stringify({ voice: "v", bgm: "calm" })),
    );
    expect(r.providerName).toBe("fake");
    expect(r.config.voice).toBe("v");
    expect(r.config.bgm_fade_in_sec).toBe(1.5); // DEFAULT merged in
    expect(r.yaml).toContain("bgm:");
  });

  it("unwraps a ```json fenced response", async () => {
    const r = await callAudioPlan(
      INPUT(),
      fakeProvider("```json\n" + JSON.stringify({ bgm: null }) + "\n```"),
    );
    expect(r.config.bgm).toBeNull();
  });

  it("strips <think> tags GLM emits before the JSON", async () => {
    const r = await callAudioPlan(
      INPUT(),
      fakeProvider(
        "<think>reasoning…</think>\n" + JSON.stringify({ bgm: "calm" }),
      ),
    );
    expect(r.config.bgm).toBe("calm");
  });

  it("accepts a YAML response when JSON parsing fails", async () => {
    const r = await callAudioPlan(
      INPUT(),
      fakeProvider("voice: yaml-voice\nbgm: calm\n"),
    );
    expect(r.config.voice).toBe("yaml-voice");
  });

  it("throws AudioPlanError on an empty response", async () => {
    await expect(callAudioPlan(INPUT(), fakeProvider("   "))).rejects.toThrow(
      AudioPlanError,
    );
  });

  it("throws AudioPlanError on unparseable content (neither JSON nor YAML)", async () => {
    await expect(
      callAudioPlan(INPUT(), fakeProvider("{unclosed: [")),
    ).rejects.toThrow(/JSON\/YAML parse failed/);
  });

  it("throws AudioPlanError when the parsed config fails schema validation", async () => {
    await expect(
      callAudioPlan(INPUT(), fakeProvider(JSON.stringify({ bgm: 123 }))),
    ).rejects.toThrow(/audio-config invalid/);
  });
});
