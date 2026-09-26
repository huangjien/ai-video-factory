import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  ArticleFrontmatterSchema,
  SceneBlockSchema,
  parseArticle,
  articleToStoryboardYaml,
  type ParsedArticle,
} from "./schemas.js";

const SAMPLE_MD = `---
project: ai-think
language: zh-CN
duration_target_sec: 40
voice: zh-CN-YunjianNeural
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
    expect(r.frontmatter.voice).toBe("zh-CN-YunjianNeural");
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
voice: zh-CN-YunjianNeural
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
voice: zh-CN-YunjianNeural
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
      voice: "zh-CN-YunjianNeural",
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

describe("articleToStoryboardYaml (VDSL sync)", () => {
  const fixture: ParsedArticle = {
    frontmatter: {
      project: "ai-think",
      language: "zh-CN",
      duration_target_sec: 40,
      voice: "zh-CN-YunjianNeural",
    },
    proseBody: "",
    scenes: [
      {
        id: "scene_1",
        duration: 8,
        caption: "开场",
        visual: "两个数据库图标之间流动的同步箭头动画",
        narration: "今天我们谈一下同步测试",
      },
      {
        id: "scene_2",
        duration: 6,
        caption: "细节",
        visual: "",
        narration: "对账脚本是最常用的方法",
      },
    ],
    markdown: "",
  };

  it("renders the VDSL header (schema_version + project + style)", () => {
    const yaml = articleToStoryboardYaml(fixture);
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed["schema_version"]).toBe("0.1");
    expect(parsed["project"]).toMatchObject({ id: "ai-think", language: "zh-CN", fps: 30 });
    expect(parsed["style"]).toMatchObject({ theme: "dark-tech" });
  });

  it("emits one scene per article scene with zero-padded IDs", () => {
    const yaml = articleToStoryboardYaml(fixture);
    const parsed = parseYaml(yaml) as { scenes: { id: string; duration: number }[] };
    expect(parsed.scenes).toHaveLength(2);
    expect(parsed.scenes[0]?.id).toBe("scene-01");
    expect(parsed.scenes[0]?.duration).toBe(8);
    expect(parsed.scenes[1]?.id).toBe("scene-02");
    expect(parsed.scenes[1]?.duration).toBe(6);
  });

  it("uses Title for the first scene with subtext from article.visual", () => {
    const yaml = articleToStoryboardYaml(fixture);
    const parsed = parseYaml(yaml) as {
      scenes: { visual: { component: string; props: Record<string, string> } }[];
    };
    expect(parsed.scenes[0]?.visual.component).toBe("Title");
    expect(parsed.scenes[0]?.visual.props.text).toBe("开场");
    expect(parsed.scenes[0]?.visual.props.subtext).toBe(
      "两个数据库图标之间流动的同步箭头动画",
    );
  });

  it("truncates long Title.subtext so it does not overflow the 36px <p>", () => {
    const longVisual: ParsedArticle = {
      ...fixture,
      scenes: [
        {
          id: "scene_1",
          duration: 8,
          caption: "开场",
          visual:
            "电影感开场：黑屏渐亮，浮现 2024 年科技发布会现场的大屏幕，屏幕上循环播放 Sora 生成的六十秒东京街景视频片段，镜头缓慢推近屏幕表面。",
          narration: "今天我们谈一下同步测试",
        },
      ],
    };
    const yaml = articleToStoryboardYaml(longVisual);
    const parsed = parseYaml(yaml) as {
      scenes: { visual: { props: { subtext: string } } }[];
    };
    const sub = parsed.scenes[0]?.visual.props.subtext ?? "";
    expect(sub.length).toBeLessThanOrEqual(51);
    expect(sub).toMatch(/…$/);
  });

  it("uses AnimatedIllustration for subsequent scenes (caption + visual)", () => {
    const yaml = articleToStoryboardYaml(fixture);
    const parsed = parseYaml(yaml) as {
      scenes: { visual: { component: string; props: Record<string, string> } }[];
    };
    expect(parsed.scenes[1]?.visual.component).toBe("AnimatedIllustration");
    expect(parsed.scenes[1]?.visual.props.text).toBe(fixture.scenes[1]?.caption);
    expect(parsed.scenes[1]?.visual.props.visual).toBe(fixture.scenes[1]?.visual);
  });

  it("escapes newlines and quotes in narration so the YAML parses", () => {
    const withNewline: ParsedArticle = {
      ...fixture,
      scenes: [
        {
          id: "scene_1",
          duration: 8,
          caption: "X",
          visual: "",
          narration: "line one\nline two with \"quote\"",
        },
      ],
    };
    const yaml = articleToStoryboardYaml(withNewline);
    const parsed = parseYaml(yaml) as {
      scenes: { narration: { text: string } }[];
    };
    expect(parsed.scenes[0]?.narration.text).toBe(
      'line one\nline two with "quote"',
    );
  });
});

describe("parseArticleLenient + recoverEmptyNarrations (malformed draft)", () => {
  const MALFORMED_ARTICLE = `---
project: harness-engineering
language: zh-CN
duration_target_sec: 300
voice: zh-CN-YunjianNeural
---

# Harness 工程:智能体的隐形引擎

> Hook: 同一个模型,同样的提示词。

## 1. Harness 到底是什么

同一个模型在不同团队手里的表现可以天差地别:有的智能体能自动跑测试、直接提交拉取请求。差别通常不在模型本身,而在模型外围那套系统。

## 2. 四大核心组件

裸模型直接上岗,问题很快暴露:调用不存在的接口、改错文件、一本正经地编造结果。关键是边界由系统强制而非提示词恳求,反馈回路让错误在几秒内被纠正。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 14
    caption: A
    visual: ""
    narration: ""
  - id: scene_2
    duration: 14
    caption: B
    visual: ""
    narration: ""
  - id: scene_3
    duration: 14
    caption: C
    visual: ""
    narration: ""
  - id: scene_4
    duration: 14
    caption: D
    visual: ""
    narration: ""
\`\`\`
`;

  it("strict parseArticle rejects empty narrations", () => {
    const { parseArticle } = require("@vf/draft");
    expect(() => parseArticle(MALFORMED_ARTICLE)).toThrow(/too_small/);
  });

  it("parseArticleLenient accepts the malformed draft", () => {
    const { parseArticleLenient } = require("@vf/draft");
    const parsed = parseArticleLenient(MALFORMED_ARTICLE);
    expect(parsed.scenes).toHaveLength(4);
    expect(parsed.scenes[0]?.narration).toBe("");
  });

  it("recoverEmptyNarrations back-fills each scene from the matching section body", () => {
    const { parseArticleLenient, recoverEmptyNarrations } = require("@vf/draft");
    const parsed = parseArticleLenient(MALFORMED_ARTICLE);
    const { article, recoveredCount } = recoverEmptyNarrations(parsed);
    expect(recoveredCount).toBe(4);
    expect(article.scenes[0]?.narration).toMatch(/同一个模型/);
    expect(article.scenes[0]?.narration).not.toMatch(/Hook/);
    expect(article.scenes[2]?.narration).toMatch(/调用不存在的接口/);
    expect(article.scenes[3]?.narration).toMatch(/反馈回路/);
  });

  it("does not touch scenes that already have narration", () => {
    const { parseArticleLenient, recoverEmptyNarrations } = require("@vf/draft");
    const md = MALFORMED_ARTICLE.replace(
      'caption: D\n    visual: ""\n    narration: ""',
      'caption: D\n    visual: ""\n    narration: "kept verbatim"',
    );
    const parsed = parseArticleLenient(md);
    const { article, recoveredCount } = recoverEmptyNarrations(parsed);
    expect(recoveredCount).toBe(3);
    expect(article.scenes[3]?.narration).toBe("kept verbatim");
  });

  it("parseArticleWithRecovery accepts good drafts unchanged and recovers malformed ones", () => {
    const { parseArticleWithRecovery } = require("@vf/draft");
    const good = parseArticleWithRecovery(SAMPLE_MD);
    expect(good.recoveredCount).toBe(0);
    expect(good.article.scenes).toHaveLength(2);

    const bad = parseArticleWithRecovery(MALFORMED_ARTICLE);
    expect(bad.recoveredCount).toBe(4);
    expect(bad.article.scenes[0]?.narration).toMatch(/同一个模型/);
  });

  it("parseArticleWithRecovery rethrows non-narration parse errors", () => {
    const { parseArticleWithRecovery } = require("@vf/draft");
    expect(() => parseArticleWithRecovery("# title\n\nfoo\n")).toThrow(
      /frontmatter/,
    );
  });
});
