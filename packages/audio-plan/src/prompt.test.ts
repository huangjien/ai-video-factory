import { describe, expect, it } from "vitest";
import { parseArticle } from "@video/draft";
import { SYSTEM_PROMPT, buildMessages } from "./prompt.js";

const ARTICLE_MD = `---
project: ap-prompt
language: zh-CN
duration_target_sec: 12
voice: zh-CN-YunjianNeural
---

# 演示标题

> **Hook** (≤12s): h。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 5
    caption: 开场
    visual: 网络图
    narration: 一。
  - id: scene_2
    duration: 6
    caption: 结尾
    visual: 公式
    narration: 二。
\`\`\`
`;

describe("audio-plan prompt", () => {
  const msgs = buildMessages({
    article: parseArticle(ARTICLE_MD),
    language: "zh-CN",
  });

  it("emits system + user", () => {
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("system");
    expect(msgs[0]?.content).toBe(SYSTEM_PROMPT);
    expect(msgs[1]?.role).toBe("user");
  });

  it("summarizes every scene as id (duration): caption — visual", () => {
    const user = msgs[1]?.content ?? "";
    expect(user).toContain("- scene_1 (5s): 开场 — 网络图");
    expect(user).toContain("- scene_2 (6s): 结尾 — 公式");
    expect(user).toContain("Total scenes: 2");
    expect(user).toContain("Language: zh-CN");
  });

  it("includes the article title", () => {
    expect(msgs[1]?.content ?? "").toContain("演示标题");
  });

  it("appends the revision block only when fromContent is given", () => {
    const revise =
      buildMessages({
        article: parseArticle(ARTICLE_MD),
        language: "zh-CN",
        fromContent: "voice: old\n",
      })[1]?.content ?? "";
    expect(revise).toContain("Existing audio-config.yaml to revise");
    expect(revise).toContain("voice: old");

    const fresh = msgs[1]?.content ?? "";
    expect(fresh).not.toContain("Existing audio-config.yaml");
  });
});
