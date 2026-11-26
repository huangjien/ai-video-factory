import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";

import { callBilibili, extractYaml } from "./agent.js";
import { buildBilibiliMessages } from "./prompt.js";

function fakeProvider(respond: () => string): Provider {
  return {
    name: "fake",
    async chat(_req: ChatRequest): Promise<ChatResponse> {
      return { content: respond(), usage: { input: 1, output: 1 } };
    },
  };
}

const article = `# 谁被允许下阴间

> **Hook**: 孙悟空的名字一写进生死簿，地府便来勾魂。

## 1. 死了也未必能进

阎罗凭簿册拘人，阎摩为死者指出先人之路。
`;

const goodYaml = `\`\`\`yaml
title: 谁被允许下阴间：阎罗、阎摩与赫尔墨斯的三套规则
description: 生死簿、阎摩的先人之路、卡戎的渡资——三套规则，三种准入。
tags:
  - 西游记
  - 阎罗
  - 比较神话
suggested_category: 知识
cover_prompt: A wary traveler at a three-way threshold under a charcoal underworld gate.
\`\`\``;

describe("buildBilibiliMessages", () => {
  it("puts the visual identity first, so the cover inherits the video's style", () => {
    const user =
      buildBilibiliMessages({
        article,
        imageStyle: "flat-vector",
        topic: "谁被允许下阴间",
      })[1]?.content ?? "";
    expect(user.indexOf("Visual identity")).toBeLessThan(
      user.indexOf("## Topic"),
    );
    expect(user).toContain("Style preset: flat-vector");
  });

  it("carries the topic, the runtime and the hook", () => {
    const user =
      buildBilibiliMessages({
        article,
        topic: "谁被允许下阴间",
        durationSec: 372.4,
        hook: "孙悟空的名字一写进生死簿，地府便来勾魂。",
      })[1]?.content ?? "";
    expect(user).toContain("## Topic: 谁被允许下阴间");
    expect(user).toContain("## Runtime: 372 seconds");
    expect(user).toContain("孙悟空的名字一写进生死簿");
  });

  it("sends the article so the 简介 can summarise the narration", () => {
    const user = buildBilibiliMessages({ article })[1]?.content ?? "";
    expect(user).toContain("阎罗凭簿册拘人");
    expect(user).toContain("Produce the Bilibili package YAML");
  });

  it("carries the system prompt from the registry", () => {
    const system = buildBilibiliMessages({ article })[0]?.content ?? "";
    expect(system).toContain("Output ONE YAML block");
  });
});

describe("extractYaml", () => {
  it("reads the fenced block the model answered with", () => {
    expect(extractYaml(goodYaml)).toContain("title:");
  });
});

describe("callBilibili", () => {
  it("returns the package the agent wrote", async () => {
    const result = await callBilibili(
      { article },
      fakeProvider(() => goodYaml),
    );
    expect(result.source).toBe("agent");
    expect(result.bilibili.title).toBe(
      "谁被允许下阴间：阎罗、阎摩与赫尔墨斯的三套规则",
    );
    expect(result.bilibili.tags).toEqual(["西游记", "阎罗", "比较神话"]);
  });

  it("degrades to a package built from the article when the model fails", async () => {
    const result = await callBilibili(
      { article },
      fakeProvider(() => "not yaml"),
    );
    expect(result.source).toBe("fallback");
    expect(result.bilibili.title).toBe("谁被允许下阴间");
    expect(result.warning).toBeDefined();
  });

  it("degrades on a provider outage instead of throwing", async () => {
    const provider: Provider = {
      name: "fake",
      async chat(_req: ChatRequest): Promise<ChatResponse> {
        throw new Error("provider is down");
      },
    };
    const result = await callBilibili({ article }, provider);
    expect(result.source).toBe("fallback");
    expect(result.warning).toContain("provider is down");
  });

  it("degrades when the package breaks the schema", async () => {
    const result = await callBilibili(
      { article },
      // An empty tag list is fine; a tag that is not a string is not.
      fakeProvider(
        () =>
          `\`\`\`yaml\ntitle: t\ndescription: d\ntags: [1, 2]\nsuggested_category: 知识\ncover_prompt: c\n\`\`\``,
      ),
    );
    expect(result.source).toBe("fallback");
  });

  it("fails over to the second provider when the first is rate-limited", async () => {
    const limited: Provider = {
      name: "limited",
      async chat(_req: ChatRequest): Promise<ChatResponse> {
        throw Object.assign(new Error("429 too many requests"), {
          status: 429,
        });
      },
    };
    const result = await callBilibili(
      { article },
      limited,
      fakeProvider(() => goodYaml),
    );
    expect(result.source).toBe("agent");
    expect(result.bilibili.title).toBe(
      "谁被允许下阴间：阎罗、阎摩与赫尔墨斯的三套规则",
    );
  });
});
