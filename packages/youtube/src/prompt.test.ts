import { describe, expect, it } from "vitest";

import { buildYouTubeMessages } from "./prompt.js";

const base = {
  storyboard: 'schema_version: "0.2"\nscenes: []',
  script: "# 谁被允许下阴间\n\n生死簿与冥河。",
  research: "《西游记》第三回",
};

describe("buildYouTubeMessages", () => {
  it("puts the visual identity first, so the thumbnail inherits the video's style", () => {
    const user =
      buildYouTubeMessages({
        ...base,
        imageStyle: "flat-vector",
        setting: "Tang China, 7th century",
      })[1]?.content ?? "";
    expect(user.indexOf("Visual identity")).toBeLessThan(
      user.indexOf("## Storyboard"),
    );
    expect(user).toContain("Style preset: flat-vector");
    expect(user).toContain("Setting (era / region / culture): Tang China");
  });

  it("leaves the visual identity out when the article declares none", () => {
    const user = buildYouTubeMessages(base)[1]?.content ?? "";
    expect(user).not.toContain("Visual identity");
  });

  it("carries the hook and the topic", () => {
    const user =
      buildYouTubeMessages({
        ...base,
        hook: "孙悟空的名字一写进生死簿，地府便来勾魂。",
        topic: "谁被允许下阴间",
      })[1]?.content ?? "";
    expect(user).toContain("孙悟空的名字一写进生死簿");
    expect(user).toContain("## Topic: 谁被允许下阴间");
  });

  it("hands the three artifacts over, each labelled", () => {
    const user = buildYouTubeMessages(base)[1]?.content ?? "";
    expect(user).toContain("## Storyboard (VDSL)");
    expect(user).toContain("## Script (Markdown)");
    expect(user).toContain("## Research (excerpt");
    expect(user).toContain("Produce the YouTube package YAML");
  });

  it("anchors the output language, because the materials drift", () => {
    const en =
      buildYouTubeMessages({ ...base, language: "en-US" })[1]?.content ?? "";
    expect(en).toContain("## Output language (mandatory)");
    expect(en).toContain("in English (en-US)");
    const zh =
      buildYouTubeMessages({ ...base, language: "zh-CN" })[1]?.content ?? "";
    expect(zh).toContain("in Chinese (zh-CN)");
  });

  it("says nothing about the language when the caller names none", () => {
    const user = buildYouTubeMessages(base)[1]?.content ?? "";
    expect(user).not.toContain("Output language");
  });

  it("carries the system prompt from the registry", () => {
    const system = buildYouTubeMessages(base)[0]?.content ?? "";
    expect(system).toContain("ONE fenced YAML code block");
  });
});
