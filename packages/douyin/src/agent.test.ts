import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";

import { callDouyin, extractYaml } from "./agent.js";
import { buildDouyinMessages } from "./prompt.js";

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
title: 谁能下阴间？阎罗、阎摩与赫尔墨斯
description: 生死簿、阎摩的先人之路、卡戎的渡资——三套规则，三种准入。
topics:
  - 阎罗
  - 阎摩
  - 神话比较
cover_prompt: A wary traveler at a three-way threshold under a charcoal underworld gate.
\`\`\``;

describe("buildDouyinMessages", () => {
  it("puts the visual identity first, so the cover inherits the video's style", () => {
    const user =
      buildDouyinMessages({
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
      buildDouyinMessages({
        article,
        topic: "谁被允许下阴间",
        durationSec: 372.4,
        hook: "孙悟空的名字一写进生死簿，地府便来勾魂。",
      })[1]?.content ?? "";
    expect(user).toContain("## Topic: 谁被允许下阴间");
    expect(user).toContain("## Runtime: 372 seconds");
    expect(user).toContain("孙悟空的名字一写进生死簿");
  });

  it("sends the article so the 文案 can summarise the narration", () => {
    const user = buildDouyinMessages({ article })[1]?.content ?? "";
    expect(user).toContain("阎罗凭簿册拘人");
    expect(user).toContain("Produce the Douyin package YAML");
  });

  it("carries the system prompt from the registry", () => {
    const system = buildDouyinMessages({ article })[0]?.content ?? "";
    expect(system).toContain("Output ONE YAML block");
    expect(system).toContain("cover_prompt");
  });
});

describe("extractYaml", () => {
  it("reads the fenced block the model answered with", () => {
    expect(extractYaml(goodYaml)).toContain("title:");
  });
});

describe("callDouyin", () => {
  it("returns the package the agent wrote", async () => {
    const result = await callDouyin(
      { article },
      fakeProvider(() => goodYaml),
    );
    expect(result.source).toBe("agent");
    expect(result.douyin.title).toBe("谁能下阴间？阎罗、阎摩与赫尔墨斯");
    expect(result.douyin.topics).toEqual(["阎罗", "阎摩", "神话比较"]);
  });

  it("degrades to a package built from the article when the model fails", async () => {
    const result = await callDouyin(
      { article },
      fakeProvider(() => "not yaml"),
    );
    expect(result.source).toBe("fallback");
    expect(result.douyin.title).toBe("谁被允许下阴间");
    expect(result.warning).toBeDefined();
  });

  it("degrades on a provider outage instead of throwing", async () => {
    const provider: Provider = {
      name: "fake",
      async chat(_req: ChatRequest): Promise<ChatResponse> {
        throw new Error("provider is down");
      },
    };
    const result = await callDouyin({ article }, provider);
    expect(result.source).toBe("fallback");
    expect(result.warning).toContain("provider is down");
  });

  it("degrades when the package breaks the schema", async () => {
    const result = await callDouyin(
      { article },
      // A title over the platform's limit is a schema violation.
      fakeProvider(
        () =>
          `\`\`\`yaml\ntitle: "${"x".repeat(200)}"\ndescription: d\ntopics: []\ncover_prompt: c\n\`\`\``,
      ),
    );
    expect(result.source).toBe("fallback");
  });

  it("fails over to the second provider when the first is rate-limited", async () => {
    const limited: Provider = {
      name: "limited",
      async chat(_req: ChatRequest): Promise<ChatResponse> {
        // A 429 is a failover-eligible error: the second provider serves.
        throw Object.assign(new Error("429 too many requests"), {
          status: 429,
        });
      },
    };
    const result = await callDouyin(
      { article },
      limited,
      fakeProvider(() => goodYaml),
    );
    expect(result.source).toBe("agent");
    expect(result.douyin.title).toBe("谁能下阴间？阎罗、阎摩与赫尔墨斯");
  });

  it("does not fail over on an error that is not the provider's fault", async () => {
    const broken: Provider = {
      name: "broken",
      async chat(_req: ChatRequest): Promise<ChatResponse> {
        throw new Error("400 invalid request");
      },
    };
    const result = await callDouyin(
      { article },
      broken,
      fakeProvider(() => goodYaml),
    );
    expect(result.source).toBe("fallback");
  });
});
