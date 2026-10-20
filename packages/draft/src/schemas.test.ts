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

  it("includes ideaSeed as the user's major idea with preserve-opinions wording", async () => {
    const { buildMessages } = await import("./prompt.js");
    const m = buildMessages({
      topic: "t",
      audience: "a",
      language: "zh-CN",
      duration: 40,
      ideaSeed: "长视频测试的核心是漂移检测，不是堆指标。",
    });
    expect(m[1]?.content).toContain("The user's major idea");
    expect(m[1]?.content).toContain("do NOT change");
    expect(m[1]?.content).toContain(
      "长视频测试的核心是漂移检测，不是堆指标。",
    );
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
    title: "同步测试",
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
    expect(parsed["schema_version"]).toBe("0.2");
    expect(parsed["project"]).toMatchObject({ id: "ai-think", language: "zh-CN", fps: 30 });
    expect(parsed["style"]).toMatchObject({ theme: "paper-light" });
  });

  it("emits a defaults block (schema_version 0.2) when frontmatter sets default_renderer", () => {
    const yaml = articleToStoryboardYaml({
      ...fixture,
      frontmatter: { ...fixture.frontmatter, default_renderer: "canvas" },
    });
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed["schema_version"]).toBe("0.2");
    expect(parsed["defaults"]).toEqual({ renderer: "canvas" });
  });

  it("omits the defaults block without frontmatter default_renderer", () => {
    const yaml = articleToStoryboardYaml(fixture);
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed["defaults"]).toBeUndefined();
    expect(parsed["schema_version"]).toBe("0.2");
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

  it("uses Title for the first scene, with the film's title as the subtitle", () => {
    const yaml = articleToStoryboardYaml(fixture);
    const parsed = parseYaml(yaml) as {
      scenes: { visual: { component: string; props: Record<string, string> } }[];
    };
    expect(parsed.scenes[0]?.visual.component).toBe("Title");
    expect(parsed.scenes[0]?.visual.props.text).toBe("开场");
    // The film's title, not the scene's art direction.
    expect(parsed.scenes[0]?.visual.props.subtext).toBe("同步测试");
  });

  it("never writes the art direction onto the title card", () => {
    // Regression: `visual:` is a PROMPT for the image model. It used to be
    // burned onto the title card as the subtitle, so the staging
    // directions appeared on screen.
    const yaml = articleToStoryboardYaml(fixture);
    const parsed = parseYaml(yaml) as {
      scenes: { visual: { props: Record<string, string> } }[];
    };
    const props = parsed.scenes[0]?.visual.props ?? {};
    expect(Object.values(props).join(" ")).not.toContain("两个数据库图标");
  });

  it("truncates a long title so it does not overflow the 36px <p>", () => {
    const longTitle: ParsedArticle = {
      ...fixture,
      title: "x".repeat(120),
    };
    const yaml = articleToStoryboardYaml(longTitle);
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
    const { parseArticle } = require("@video/draft");
    expect(() => parseArticle(MALFORMED_ARTICLE)).toThrow(/too_small/);
  });

  it("parseArticleLenient accepts the malformed draft", () => {
    const { parseArticleLenient } = require("@video/draft");
    const parsed = parseArticleLenient(MALFORMED_ARTICLE);
    expect(parsed.scenes).toHaveLength(4);
    expect(parsed.scenes[0]?.narration).toBe("");
  });

  it("recoverEmptyNarrations back-fills each scene from the matching section body", () => {
    const { parseArticleLenient, recoverEmptyNarrations } = require("@video/draft");
    const parsed = parseArticleLenient(MALFORMED_ARTICLE);
    const { article, recoveredCount } = recoverEmptyNarrations(parsed);
    expect(recoveredCount).toBe(4);
    expect(article.scenes[0]?.narration).toMatch(/同一个模型/);
    expect(article.scenes[0]?.narration).not.toMatch(/Hook/);
    expect(article.scenes[2]?.narration).toMatch(/调用不存在的接口/);
    expect(article.scenes[3]?.narration).toMatch(/反馈回路/);
  });

  it("does not touch scenes that already have narration", () => {
    const { parseArticleLenient, recoverEmptyNarrations } = require("@video/draft");
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
    const { parseArticleWithRecovery } = require("@video/draft");
    const good = parseArticleWithRecovery(SAMPLE_MD);
    expect(good.recoveredCount).toBe(0);
    expect(good.article.scenes).toHaveLength(2);

    const bad = parseArticleWithRecovery(MALFORMED_ARTICLE);
    expect(bad.recoveredCount).toBe(4);
    expect(bad.article.scenes[0]?.narration).toMatch(/同一个模型/);
  });

  it("parseArticleWithRecovery rethrows non-narration parse errors", () => {
    const { parseArticleWithRecovery } = require("@video/draft");
    expect(() => parseArticleWithRecovery("# title\n\nfoo\n")).toThrow(
      /frontmatter/,
    );
  });
});

describe("schema edge cases", () => {
  it("frontmatter rejects non-positive duration_target_sec", () => {
    const r = ArticleFrontmatterSchema.safeParse({
      project: "p",
      language: "zh-CN",
      duration_target_sec: 0,
      voice: "v",
    });
    expect(r.success).toBe(false);
  });

  it("frontmatter rejects an empty voice", () => {
    const r = ArticleFrontmatterSchema.safeParse({
      project: "p",
      language: "zh-CN",
      duration_target_sec: 10,
      voice: "",
    });
    expect(r.success).toBe(false);
  });

  it("scene rejects zero duration and empty caption", () => {
    const base = {
      id: "scene_1",
      caption: "c",
      visual: "v",
      narration: "n",
    };
    expect(
      SceneBlockSchema.safeParse({ scenes: [{ ...base, duration: 0 }] }).success,
    ).toBe(false);
    expect(
      SceneBlockSchema.safeParse({ scenes: [{ ...base, duration: 5, caption: "" }] })
        .success,
    ).toBe(false);
  });
});

describe("articleToStoryboardYaml — theme + captions flags", () => {
  const parse = () => parseArticle(SAMPLE_MD);

  it("defaults style.theme to paper-light", () => {
    const yaml = articleToStoryboardYaml(parse());
    expect(yaml).toContain("style:");
    expect(yaml).toContain('theme: "paper-light"');
  });

  it("honours frontmatter.theme when set", () => {
    const article = parse();
    article.frontmatter = { ...article.frontmatter, theme: "dark-tech" };
    const yaml = articleToStoryboardYaml(article);
    expect(yaml).toContain('theme: "dark-tech"');
  });

  it("emits the captions block by default and omits it with no_captions", () => {
    const withCaptions = articleToStoryboardYaml(parse());
    expect(withCaptions).toContain("captions:");
    expect(withCaptions).toContain("source: narration");

    const article = parse();
    article.frontmatter = { ...article.frontmatter, no_captions: true };
    const without = articleToStoryboardYaml(article);
    expect(without).not.toContain("captions:");
  });

  describe("channel_profile (CS-01)", () => {
    it("carries channel_profile into style, alongside the art style", () => {
      const article = parse();
      article.frontmatter = {
        ...article.frontmatter,
        channel_profile: "chinese-storybook",
        image_style: "gongbi",
      };
      const style = parseYaml(articleToStoryboardYaml(article)).style;
      expect(style.channel_profile).toBe("chinese-storybook");
      expect(style.theme).toBeTruthy();
    });

    it("keeps the channel profile when the art style changes", () => {
      const article = parse();
      article.frontmatter = {
        ...article.frontmatter,
        channel_profile: "chinese-storybook",
        image_style: "manga",
      };
      expect(
        parseYaml(articleToStoryboardYaml(article)).style.channel_profile,
      ).toBe("chinese-storybook");
    });

    it("omits the key entirely for articles without a profile", () => {
      const style = parseYaml(articleToStoryboardYaml(parse())).style;
      expect(style).not.toHaveProperty("channel_profile");
    });
  });

  describe("channel_profile first scene (CS-05)", () => {
    const withProfile = (fm: Record<string, string>) => {
      const article = parse();
      article.frontmatter = { ...article.frontmatter, ...fm };
      return article;
    };
    const componentsOf = (article: ReturnType<typeof parse>) =>
      parseYaml(articleToStoryboardYaml(article)).scenes.map(
        (s: { visual: { component: string } }) => s.visual.component,
      );

    it("keeps the Title card when no profile is set", () => {
      expect(componentsOf(parse())[0]).toBe("Title");
    });

    it("routes the opening shot to the image path under a profile", () => {
      const comps = componentsOf(withProfile({ channel_profile: "chinese-storybook" }));
      expect(comps[0]).toBe("AnimatedIllustration");
      expect(comps).not.toContain("Title");
    });

    it("still lets the classifier win under a profile", () => {
      const article = withProfile({ channel_profile: "chinese-storybook" });
      article.scenes[0]!.visual = "timeline of three eras";
      expect(componentsOf(article)[0]).toBe("Timeline");
    });
  });
});

describe("scene text overlay (CS-06)", () => {
  const withProfile = (fm: Record<string, string>) => {
    const article = parseArticle(SAMPLE_MD);
    article.frontmatter = { ...article.frontmatter, ...fm };
    return article;
  };

  it("overlays the article's H1 on the opening shot under a profile", () => {
    const board = parseYaml(
      articleToStoryboardYaml(withProfile({ channel_profile: "chinese-storybook" })),
    ) as { scenes: { id: string; overlay?: { title?: string } }[] };
    expect(board.scenes[0]?.overlay?.title).toBe("AI 思维链");
    // The title rides the FIRST shot — it is not a scene of its own.
    expect(board.scenes.length).toBeGreaterThan(1);
  });

  it("gives no overlay at all when no profile is set", () => {
    const board = parseYaml(articleToStoryboardYaml(parseArticle(SAMPLE_MD))) as {
      scenes: { overlay?: unknown }[];
    };
    for (const s of board.scenes) expect(s.overlay).toBeUndefined();
  });

  it("writes a chapter name only where a prose section turns", () => {
    const board = parseYaml(
      articleToStoryboardYaml(withProfile({ channel_profile: "chinese-storybook" })),
    ) as {
      scenes: { id: string; overlay?: { title?: string; chapter?: string } }[];
    };
    expect(board.scenes[0]?.overlay?.title).toBe("AI 思维链");
    // A chapter appears only at the turn, not on every scene.
    const chapters = board.scenes
      .map((s) => s.overlay?.chapter)
      .filter((c) => c !== undefined);
    expect(chapters.length).toBeLessThan(board.scenes.length);
    expect(chapters).toContain("2. 解释");
  });

  it("gives every scene an object for visual.props", () => {
    // A `props:` key with no children parses as null, and the VDSL visual
    // schema requires an object — the compile step refuses the board
    // otherwise. An empty props object must be written as `{}`.
    const board = parseYaml(articleToStoryboardYaml(parseArticle(SAMPLE_MD))) as {
      scenes: { visual: { props: unknown } }[];
    };
    for (const s of board.scenes) {
      expect(typeof s.visual.props).toBe("object");
      expect(s.visual.props).not.toBeNull();
    }
  });
});
