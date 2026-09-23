import { describe, expect, it } from "vitest";
import {
  ArticleFrontmatterSchema,
  SceneBlockSchema,
  parseArticle,
} from "./schemas.js";

const SAMPLE_MD = `---
project: ai-think
language: zh-CN
duration_target_sec: 40
voice: zh-CN-XiaoxiaoNeural
---

# AI 思维链

> **Hook** (≤20s): 在 AI 时代，理解思维链比学 API 更重要。

## 1. 问题

大模型怎么思考？

## 2. 解释

分步骤思考的技术。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 10
    caption: "问题"
    visual: "图标"
    narration: |
      在 AI 时代
      思维链很关键
  - id: scene_2
    duration: 30
    caption: "结论"
    visual: "结束画面"
    narration: |
      试试看
\`\`\`
`;

describe("parseArticle (markdown-first)", () => {
  it("splits frontmatter + prose + scenes block", () => {
    const r = parseArticle(SAMPLE_MD);
    expect(r.frontmatter.project).toBe("ai-think");
    expect(r.frontmatter.language).toBe("zh-CN");
    expect(r.frontmatter.duration_target_sec).toBe(40);
    expect(r.frontmatter.voice).toBe("zh-CN-XiaoxiaoNeural");
    expect(r.scenes).toHaveLength(2);
    expect(r.scenes[0]?.id).toBe("scene_1");
    expect(r.scenes[0]?.duration).toBe(10);
    expect(r.proseBody).toContain("# AI 思维链");
    expect(r.proseBody).toContain("## 1. 问题");
  });

  it("preserves the original markdown for round-trip", () => {
    const r = parseArticle(SAMPLE_MD);
    expect(r.markdown).toBe(SAMPLE_MD);
  });

  it("rejects article with no frontmatter", () => {
    expect(() => parseArticle("# title\n\nfoo\n")).toThrow(/frontmatter/);
  });

  it("rejects article with no Scenes heading", () => {
    const md = `---
project: t
language: zh-CN
duration_target_sec: 40
voice: zh-CN-XiaoxiaoNeural
---

# title

no scenes heading
`;
    expect(() => parseArticle(md)).toThrow(/Scenes.*heading/);
  });

  it("rejects Scenes heading without a YAML code block", () => {
    const md = `---
project: t
language: zh-CN
duration_target_sec: 40
voice: zh-CN-XiaoxiaoNeural
---

## Scenes

no fence here
`;
    expect(() => parseArticle(md)).toThrow(/YAML code block/);
  });
});

describe("ArticleFrontmatterSchema", () => {
  it("accepts the canonical shape", () => {
    const fm = ArticleFrontmatterSchema.parse({
      project: "t",
      language: "zh-CN",
      duration_target_sec: 40,
      voice: "zh-CN-XiaoxiaoNeural",
    });
    expect(fm.project).toBe("t");
  });

  it("rejects unknown language enum", () => {
    expect(() =>
      ArticleFrontmatterSchema.parse({
        project: "t",
        language: "fr-FR",
        duration_target_sec: 40,
        voice: "x",
      }),
    ).toThrow();
  });

  it("passes through extra fields (so LLM can add bgm, voice_style, etc.)", () => {
    const fm = ArticleFrontmatterSchema.parse({
      project: "t",
      language: "zh-CN",
      duration_target_sec: 40,
      voice: "x",
      extra_field: "ok",
    });
    expect((fm as Record<string, unknown>)["extra_field"]).toBe("ok");
  });
});

describe("SceneBlockSchema", () => {
  it("accepts a single-scene block with passthrough extras", () => {
    const sb = SceneBlockSchema.parse({
      scenes: [
        {
          id: "scene_1",
          duration: 40,
          caption: "x",
          visual: "y",
          narration: "z",
          extra_field: "ok",
        },
      ],
    });
    expect(sb.scenes).toHaveLength(1);
  });

  it("rejects empty scenes array", () => {
    expect(() => SceneBlockSchema.parse({ scenes: [] })).toThrow();
  });
});

describe("buildMessages (prompt structure)", () => {
  it("emits system + user with topic", async () => {
    const { buildMessages } = await import("./prompt.js");
    const m = buildMessages({
      topic: "AI 思维链",
      audience: "developers",
      language: "zh-CN",
      duration: 40,
    });
    expect(m[0]?.role).toBe("system");
    expect(m[1]?.role).toBe("user");
    expect(m[1]?.content).toContain("AI 思维链");
    expect(m[1]?.content).toContain("zh-CN");
  });

  it("includes web context when provided", async () => {
    const { buildMessages } = await import("./prompt.js");
    const m = buildMessages({
      topic: "t",
      audience: "a",
      language: "zh-CN",
      duration: 40,
      webContext: [
        { url: "https://example.com", title: "Ex", snippet: "An important snippet about X." },
      ],
    });
    expect(m[1]?.content).toContain("An important snippet about X");
  });

  it("includes fromContent for revision", async () => {
    const { buildMessages } = await import("./prompt.js");
    const m = buildMessages({
      topic: "t",
      audience: "a",
      language: "zh-CN",
      duration: 40,
      fromContent: "old draft here",
    });
    expect(m[1]?.content).toContain("old draft here");
  });
});
