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

  it("matches network/flow/pipeline to SvgScene (draw-on diagram family)", () => {
    expect(
      pickVisualComponent("a network of nodes connected by edges", false).component,
    ).toBe("SvgScene");
    expect(pickVisualComponent("流水线 步骤 流程", false).component).toBe(
      "SvgScene",
    );
    expect(pickVisualComponent("flow of data through a pipeline", false).component).toBe(
      "SvgScene",
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

  it("matches list keywords to Checklist (DoodleScene is never auto-selected)", () => {
    expect(
      pickVisualComponent("a list of key bullet points", false).component,
    ).toBe("Checklist");
    expect(pickVisualComponent("列表 要点 提纲", false).component).toBe(
      "Checklist",
    );
  });

  it("matches quote keywords to QuoteBlock (v0.4.2, was Callout)", () => {
    expect(pickVisualComponent("a famous quote from Einstein", false).component).toBe(
      "QuoteBlock",
    );
    expect(pickVisualComponent("引用 说过 指出", false).component).toBe(
      "QuoteBlock",
    );
    expect(pickVisualComponent("一句金句 名言", false).component).toBe(
      "QuoteBlock",
    );
  });

  it("matches cycle/loop keywords to CycleDiagram", () => {
    expect(pickVisualComponent("the feedback loop iterates", false).component).toBe(
      "CycleDiagram",
    );
    expect(pickVisualComponent("闭环 迭代 飞轮", false).component).toBe(
      "CycleDiagram",
    );
  });

  it("matches ranking keywords to Leaderboard", () => {
    expect(pickVisualComponent("top 10 leaderboard ranking", false).component).toBe(
      "Leaderboard",
    );
    expect(pickVisualComponent("排行榜 冠军 前十", false).component).toBe(
      "Leaderboard",
    );
  });

  it("matches chart/distribution keywords to BarChart", () => {
    expect(pickVisualComponent("market share distribution chart", false).component).toBe(
      "BarChart",
    );
    expect(pickVisualComponent("柱状图 分布 构成", false).component).toBe(
      "BarChart",
    );
  });

  it("matches percent/statistics keywords to StatGrid", () => {
    expect(pickVisualComponent("accuracy is 95% wow", false).component).toBe(
      "StatGrid",
    );
    expect(pickVisualComponent("增长 百分比 统计数据", false).component).toBe(
      "StatGrid",
    );
  });

  it("matches checklist keywords to Checklist", () => {
    expect(pickVisualComponent("a pre-flight checklist", false).component).toBe(
      "Checklist",
    );
    expect(pickVisualComponent("避坑清单 注意事项", false).component).toBe(
      "Checklist",
    );
  });

  it("matches pyramid/hierarchy keywords to PyramidDiagram", () => {
    expect(pickVisualComponent("a hierarchy of layers", false).component).toBe(
      "PyramidDiagram",
    );
    expect(pickVisualComponent("金字塔 层级 分层", false).component).toBe(
      "PyramidDiagram",
    );
  });

  it("matches venn/overlap keywords to VennDiagram", () => {
    expect(pickVisualComponent("a venn diagram with overlap", false).component).toBe(
      "VennDiagram",
    );
    expect(pickVisualComponent("交集 重叠 融合", false).component).toBe(
      "VennDiagram",
    );
  });

  it("matches key-insight keywords to BigIdea", () => {
    expect(pickVisualComponent("the key takeaway of this video", false).component).toBe(
      "BigIdea",
    );
    expect(pickVisualComponent("核心观点 一句话总结", false).component).toBe(
      "BigIdea",
    );
  });

  it("list keywords never select DoodleScene (retired from auto-selection)", () => {
    expect(
      pickVisualComponent("a list of key bullet points", false).component,
    ).not.toBe("DoodleScene");
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
      "SvgScene",
      "DoodleScene",
      "QuoteBlock",
      "StatGrid",
      "BarChart",
      "Leaderboard",
      "Checklist",
      "BigIdea",
      "PyramidDiagram",
      "VennDiagram",
      "CycleDiagram",
    ]);
    expect(
      pickVisualComponent("database table", false).component,
    ).toBe("Callout");
    expect(
      pickVisualComponent("equation derivation", false).component,
    ).toBe("Callout");
    expect(pickVisualComponent("a quote", false).component).toBe("QuoteBlock");
    // Every rule's component must exist in the registered set above.
    for (const visual of [
      "a quote", "cycle loop", "top 10 ranking", "chart distribution",
      "95% stats", "checklist best practices", "pyramid hierarchy",
      "venn overlap", "key takeaway",
    ]) {
      expect(registered).toContain(pickVisualComponent(visual, false).component);
    }
    expect([...registered]).toContain(
      pickVisualComponent("a serene lake at sunset", false).component,
    );
  });

  it("first scene is always Title", () => {
    const r = pickVisualComponent("anything", true);
    expect(r.component).toBe("Title");
  });
});