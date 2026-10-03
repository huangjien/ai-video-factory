import { describe, expect, it } from "vitest";
import { pickVisualComponent } from "./visual-classifier.js";

describe("pickVisualComponent (T2 visual variety)", () => {
  it("first scene is always Title regardless of visual text", () => {
    const r = pickVisualComponent("anything goes here", true);
    expect(r.component).toBe("Title");
  });

  it("matches database / SQL keywords to Callout kind=data", () => {
    expect(pickVisualComponent("a database table with rows", false).component).toBe(
      "Callout",
    );
    expect(pickVisualComponent("数据库表格 字段 列存", false).component).toBe(
      "Callout",
    );
  });

  it("matches network/flow/pipeline to FlowChart", () => {
    expect(
      pickVisualComponent("a network of nodes connected by edges", false).component,
    ).toBe("FlowChart");
    expect(pickVisualComponent("流水线 步骤 流程", false).component).toBe(
      "FlowChart",
    );
    expect(pickVisualComponent("flow of data through a pipeline", false).component).toBe(
      "FlowChart",
    );
  });

  it("matches comparison keywords to Comparison", () => {
    expect(pickVisualComponent("before vs after comparison", false).component).toBe(
      "Comparison",
    );
    expect(pickVisualComponent("前后对比 区别", false).component).toBe(
      "Comparison",
    );
  });

  it("matches code/terminal/console to Terminal", () => {
    expect(pickVisualComponent("a terminal command line", false).component).toBe(
      "Terminal",
    );
    expect(pickVisualComponent("代码片段 控制台", false).component).toBe(
      "Terminal",
    );
  });

  it("matches history/timeline to Timeline", () => {
    expect(
      pickVisualComponent("a timeline showing decades of progress", false).component,
    ).toBe("Timeline");
    expect(pickVisualComponent("历史 年表 沿革", false).component).toBe(
      "Timeline",
    );
  });

  it("matches formula/equation to Callout kind=formula", () => {
    expect(pickVisualComponent("a formula derivation", false).component).toBe(
      "Callout",
    );
    expect(pickVisualComponent("公式 推导 表达式", false).component).toBe(
      "Callout",
    );
  });

  it("matches list keywords to AnimatedIllustration (registered name)", () => {
    expect(
      pickVisualComponent("a list of key bullet points", false).component,
    ).toBe("AnimatedIllustration");
    expect(pickVisualComponent("列表 要点 提纲", false).component).toBe(
      "AnimatedIllustration",
    );
  });

  it("matches quote keywords to Callout kind=quote", () => {
    expect(pickVisualComponent("a famous quote from Einstein", false).component).toBe(
      "Callout",
    );
    expect(pickVisualComponent("引用 说过 指出", false).component).toBe(
      "Callout",
    );
  });

  it("falls through to AnimatedIllustration on no match", () => {
    expect(
      pickVisualComponent("a serene lake at sunset", false).component,
    ).toBe("AnimatedIllustration");
    expect(pickVisualComponent("安静 神秘 优雅", false).component).toBe(
      "AnimatedIllustration",
    );
  });

  it("every rule returns a REGISTRY-registered component (no kind hints)", () => {
    const registered = new Set([
      "Title",
      "AnimatedIllustration",
      "Callout",
      "FlowChart",
      "Comparison",
      "Terminal",
      "Timeline",
    ]);
    expect(
      pickVisualComponent("database table", false).component,
    ).toBe("Callout");
    expect(
      pickVisualComponent("equation derivation", false).component,
    ).toBe("Callout");
    expect(pickVisualComponent("a quote", false).component).toBe("Callout");
    expect([...registered]).toContain(
      pickVisualComponent("a serene lake at sunset", false).component,
    );
  });

  it("first scene is always Title", () => {
    const r = pickVisualComponent("anything", true);
    expect(r.component).toBe("Title");
  });
});