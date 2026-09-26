import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChatRequest, ChatResponse, Provider } from "@vf/llm";
import { parseArticle } from "@vf/draft";
import { writeAudioConfigIfAbsent } from "./draft-command.js";

const ARTICLE_MD = `---
project: merge-test
language: zh-CN
duration_target_sec: 40
voice: zh-CN-YunjianNeural
---

# Merge Test

## 1. Section

正文内容,足够长以构成旁白。第二句话补充细节。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 20
    caption: A
    visual: "flow: 输入输出流程图"
    narration: 第一场景旁白。
  - id: scene_2
    duration: 20
    caption: B
    visual: "compare: 左右对比"
    narration: 第二场景旁白。
\`\`\`
`;

const PLAN_JSON = JSON.stringify({
  voice: "zh-CN-YunjianNeural",
  bgm: "calm",
  bgm_fade_in_sec: 2,
  bgm_fade_out_sec: 2,
  pause_between_sentences_sec: 0.5,
  sfx: { scene_1: "whoosh" },
});

function fakeProvider(behavior: "ok" | "fail"): Provider {
  return {
    name: "fake",
    async chat(req: ChatRequest): Promise<ChatResponse> {
      if (behavior === "fail") {
        throw new Error("simulated provider outage");
      }
      return {
        content: PLAN_JSON,
        usage: { input: 100, output: 50 },
      };
    },
  };
}

describe("writeAudioConfigIfAbsent (merged vf draft audio-plan step)", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vf-draft-merge-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes audio-config.yaml from the fresh article", async () => {
    const root = path.join(dir, "fresh");
    mkdirSync(root, { recursive: true });
    const article = parseArticle(ARTICLE_MD);
    const step = await writeAudioConfigIfAbsent(
      root,
      article,
      fakeProvider("ok"),
      null,
    );
    expect(step.status).toBe("written");
    const yaml = readFileSync(path.join(root, "audio-config.yaml"), "utf8");
    expect(yaml).toContain("calm");
    expect(yaml).toContain("scene_1");
  });

  it("keeps an existing audio-config.yaml (hand edits win)", async () => {
    const root = path.join(dir, "existing");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      path.join(root, "audio-config.yaml"),
      "voice: zh-CN-YunjianNeural\nbgm: my-own-choice\n",
      "utf8",
    );
    const article = parseArticle(ARTICLE_MD);
    const step = await writeAudioConfigIfAbsent(
      root,
      article,
      fakeProvider("ok"),
      null,
    );
    expect(step.status).toBe("skipped");
    expect(readFileSync(path.join(root, "audio-config.yaml"), "utf8")).toContain(
      "my-own-choice",
    );
  });

  it("degrades to failed (not thrown) on a provider outage", async () => {
    const root = path.join(dir, "outage");
    mkdirSync(root, { recursive: true });
    const article = parseArticle(ARTICLE_MD);
    const step = await writeAudioConfigIfAbsent(
      root,
      article,
      fakeProvider("fail"),
      null,
    );
    expect(step.status).toBe("failed");
    expect(step.status === "failed" && step.error).toMatch(/outage/);
  });

  it("honors the skip option", async () => {
    const root = path.join(dir, "skipped");
    mkdirSync(root, { recursive: true });
    const article = parseArticle(ARTICLE_MD);
    const step = await writeAudioConfigIfAbsent(
      root,
      article,
      fakeProvider("ok"),
      null,
      { skip: true },
    );
    expect(step.status).toBe("skipped");
  });
});