import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";
import { callYouTube, extractYaml } from "./agent.js";

const GOOD_YAML = [
  "```yaml",
  'title: "读者为什么弃书"',
  "description: |",
  "  正文一段。",
  '  Key claim: 把"写好小说"换成"减少弃读"。',
  "chapters:",
  '  - timestamp: "00:00"',
  '    title: "开场"',
  'thumbnail_prompt: "a person · medium shot · warm light"',
  'shorts_hook: "hook text"',
  "```",
].join("\n");

/** The 2026-10-20 failure: a double-quoted description whose inner quote
 *  closed the scalar early — "Unexpected scalar at node end". */
const BROKEN_YAML = [
  "```yaml",
  'title: "读者为什么弃书"',
  'description: "正文一段。 Key claim: 把"写好小说"换成"减少弃读"，十项理由"',
  "chapters:",
  '  - timestamp: "00:00"',
  '    title: "开场"',
  'thumbnail_prompt: "a person · medium shot · warm light"',
  'shorts_hook: "hook text"',
  "```",
].join("\n");

function fakeProvider(name: string, content: string): Provider {
  return {
    name,
    async chat(_req: ChatRequest): Promise<ChatResponse> {
      return { content, usage: { input_tokens: 1, output_tokens: 1 } as never };
    },
  };
}

const INPUT = { storyboard: "s", script: "s", research: "r" };

describe("callYouTube — a content failure falls through to the fallback provider", () => {
  it("uses the fallback's package when the primary's YAML is malformed", async () => {
    const res = await callYouTube(
      INPUT,
      fakeProvider("glm", BROKEN_YAML),
      fakeProvider("minimax", GOOD_YAML),
    );
    expect(res.providerName).toBe("minimax");
    expect(res.youtube.title).toBe("读者为什么弃书");
  });

  it("throws the PRIMARY's error when the fallback also fails", async () => {
    await expect(
      callYouTube(
        INPUT,
        fakeProvider("glm", BROKEN_YAML),
        fakeProvider("minimax", BROKEN_YAML),
      ),
    ).rejects.toThrow(/YAML parse failed/);
  });

  it("does not call the fallback when the primary succeeds", async () => {
    let fallbackCalls = 0;
    const counting: Provider = {
      name: "minimax",
      async chat(): Promise<ChatResponse> {
        fallbackCalls += 1;
        return {
          content: GOOD_YAML,
          usage: { input_tokens: 1, output_tokens: 1 } as never,
        };
      },
    };
    const res = await callYouTube(
      INPUT,
      fakeProvider("glm", GOOD_YAML),
      counting,
    );
    expect(res.providerName).toBe("glm");
    expect(fallbackCalls).toBe(0);
  });
});

describe("extractYaml — a reasoning model's sketch is not the answer", () => {
  it("skips a YAML sketch inside <think> and takes the real answer", () => {
    // minimax reasons out loud, and its thinking contains a YAML sketch
    // with `...` placeholders. Taking the first fence parsed the sketch,
    // which is not a package.
    const raw = [
      "<think>",
      "```yaml",
      'title: "a sketch"',
      "description: |",
      "  ...",
      "```",
      "</think>",
      "```yaml",
      'title: "the real answer"',
      'description: "d"',
      "chapters:",
      '  - timestamp: "00:00"',
      '    title: "c"',
      'thumbnail_prompt: "p"',
      'shorts_hook: "s"',
      "```",
    ].join("\n");
    expect(extractYaml(raw)).toContain("the real answer");
    expect(extractYaml(raw)).not.toContain("a sketch");
  });

  it("still handles a plain fenced answer", () => {
    expect(extractYaml('```yaml\ntitle: "x"\n```')).toContain('title: "x"');
  });
});
