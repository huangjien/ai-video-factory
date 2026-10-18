import { describe, expect, it } from "vitest";
import {
  BILIBILI_DESCRIPTION_MAX,
  BILIBILI_TAGS_MAX,
  BILIBILI_TAG_MAX,
  BILIBILI_TITLE_MAX,
  BilibiliPackageSchema,
  buildFallbackPackage,
  clampChars,
  deriveCategory,
  deriveTags,
  extractYaml,
  renderChecklist,
} from "./index.js";
import type { Provider } from "@video/llm";
import { callBilibili } from "./index.js";

const ARTICLE = `---
project: sample
language: zh-CN
duration_target_sec: 300
image_style: editorial
---

# 提示词工程师正在消失

> **Hook** (≤20s): 2023年最风光的岗位，2026年从招聘页面成批消失。

Prompt 工程优化的是一次提问。Agent 工程面对的是一个自己跑几十步的系统。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
\`\`\`
`;

describe("clampChars", () => {
  it("counts characters, not bytes", () => {
    expect([...clampChars("中文字幕", 3)]).toHaveLength(3);
  });

  it("does not split a surrogate pair at the cut", () => {
    // "🚀" is one character but two UTF-16 units; a naive slice(0,1)
    // leaves a lone half that renders as tofu in the Bilibili form.
    const out = clampChars("🚀🚀", 1);
    expect(out).toBe("🚀");
    expect(out.length).toBe(2);
  });

  it("leaves short strings untouched", () => {
    expect(clampChars("abc", 10)).toBe("abc");
  });
});

describe("deriveTags", () => {
  it("picks terms from the subject matter, not the folder name", () => {
    const tags = deriveTags("Agent 工程与大模型，聊聊开发者的职业转型");
    expect(tags).toContain("AI Agent");
    expect(tags).toContain("大模型");
  });

  it("respects Bilibili's count cap", () => {
    const many = Array.from({ length: 30 }, (_, i) => `topic${i}`).join(" ");
    expect(deriveTags(many).length).toBeLessThanOrEqual(BILIBILI_TAGS_MAX);
  });

  it("dedupes overlapping vocabulary entries", () => {
    // "agent" and "Agent" both map to "AI Agent".
    const tags = deriveTags("agent Agent agent");
    expect(tags.filter((t) => t === "AI Agent")).toHaveLength(1);
  });
});

describe("deriveCategory", () => {
  it("maps a programming topic to a technical section", () => {
    expect(deriveCategory(["编程"])).toBe("计算机技术");
  });

  it("returns null rather than guessing when nothing matches", () => {
    expect(deriveCategory(["烘焙"])).toBeNull();
  });
});

describe("buildFallbackPackage", () => {
  const pkg = buildFallbackPackage({ article: ARTICLE });

  it("produces a package that satisfies the schema", () => {
    expect(BilibiliPackageSchema.safeParse(pkg).success).toBe(true);
  });

  it("takes the title from the article H1", () => {
    expect(pkg.title).toBe("提示词工程师正在消失");
  });

  it("never exceeds Bilibili's field limits", () => {
    const long = buildFallbackPackage({
      article: ARTICLE.replace(
        "# 提示词工程师正在消失",
        "# " + "很长的标题".repeat(60),
      ),
    });
    expect([...long.title].length).toBeLessThanOrEqual(BILIBILI_TITLE_MAX);
    expect([...long.description].length).toBeLessThanOrEqual(
      BILIBILI_DESCRIPTION_MAX,
    );
    for (const tag of long.tags) {
      expect([...tag].length).toBeLessThanOrEqual(BILIBILI_TAG_MAX);
    }
  });

  it("leaves out the Scenes YAML block", () => {
    expect(pkg.description).not.toContain("scenes:");
  });

  it("reuses a supplied cover prompt verbatim", () => {
    const withCover = buildFallbackPackage({
      article: ARTICLE,
      youtubeCoverPrompt: "a brass machine on a dark desk",
    });
    expect(withCover.cover_prompt).toBe("a brass machine on a dark desk");
  });

  it("stays valid for an article with no hook and no prose", () => {
    const bare = buildFallbackPackage({ article: "---\nproject: x\n---\n" });
    expect(BilibiliPackageSchema.safeParse(bare).success).toBe(true);
  });
});

describe("extractYaml", () => {
  it("unwraps a fenced block", () => {
    expect(extractYaml("blah\n```yaml\ntitle: x\n```")).toBe("title: x");
  });

  it("accepts a bare document", () => {
    expect(extractYaml("title: x")).toBe("title: x");
  });
});

describe("callBilibili degradation", () => {
  const boom: Provider = {
    name: "boom",
    async chat() {
      throw new Error("provider is down");
    },
  };

  it("falls back instead of throwing when the provider fails", async () => {
    const result = await callBilibili({ article: ARTICLE }, boom);
    expect(result.source).toBe("fallback");
    expect(result.warning).toContain("provider is down");
    expect(BilibiliPackageSchema.safeParse(result.bilibili).success).toBe(true);
  });

  const malformed: Provider = {
    name: "malformed",
    async chat() {
      return {
        content: "sorry, I cannot help with that",
        usage: { input: 0, output: 0 },
      };
    },
  };

  it("falls back on a response with no YAML", async () => {
    const result = await callBilibili({ article: ARTICLE }, malformed);
    expect(result.source).toBe("fallback");
    expect(BilibiliPackageSchema.safeParse(result.bilibili).success).toBe(true);
  });

  const oversize: Provider = {
    name: "oversize",
    async chat() {
      return {
        content: `title: "${"长".repeat(BILIBILI_TITLE_MAX + 20)}"\ntags: []\ndescription: d\nsuggested_category: null\ncover_prompt: c`,
        usage: { input: 0, output: 0 },
      };
    },
  };

  it("falls back when the model exceeds a field limit", async () => {
    const result = await callBilibili({ article: ARTICLE }, oversize);
    expect(result.source).toBe("fallback");
    expect(result.warning).toContain("schema invalid");
    expect([...result.bilibili.title].length).toBeLessThanOrEqual(
      BILIBILI_TITLE_MAX,
    );
  });

  const good: Provider = {
    name: "good",
    async chat() {
      return {
        content: [
          "```yaml",
          'title: "一个关于 Agent 的视频"',
          'description: "讲清楚一件事。"',
          "tags: [\"AI Agent\", \"大模型\"]",
          'suggested_category: "科技"',
          'cover_prompt: "a brass machine on a dark desk · medium shot"',
          "```",
        ].join("\n"),
        usage: { input: 0, output: 0 },
      };
    },
  };

  it("uses the agent output when it is valid", async () => {
    const result = await callBilibili({ article: ARTICLE }, good);
    expect(result.source).toBe("agent");
    expect(result.bilibili.suggested_category).toBe("科技");
  });
});

describe("renderChecklist", () => {
  const pkg = buildFallbackPackage({ article: ARTICLE });

  it("states that the upload is manual and why", () => {
    const out = renderChecklist({
      pkg,
      videoPath: "/tmp/final-mixed.mp4",
    });
    expect(out).toContain("没有面向第三方工具的公开投稿 API");
    expect(out).toContain("/tmp/final-mixed.mp4");
  });

  it("surfaces a fallback warning so a plain package is not mistaken for a polished one", () => {
    const out = renderChecklist({
      pkg,
      videoPath: "/tmp/final-mixed.mp4",
      warning: "LLM call failed: provider is down",
    });
    expect(out).toContain("provider is down");
    expect(out).toContain("确定性推导");
  });

  it("flags that the cover carries no title text", () => {
    const out = renderChecklist({
      pkg,
      videoPath: "/tmp/final-mixed.mp4",
      coverPath: "/tmp/cover.jpg",
    });
    expect(out).toContain("没有标题字");
  });

  it("asks the uploader to choose when no category was inferred", () => {
    const out = renderChecklist({
      pkg: { ...pkg, suggested_category: null },
      videoPath: "/tmp/final-mixed.mp4",
    });
    expect(out).toContain("无法可靠推断分区");
  });
});
