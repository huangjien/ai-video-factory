import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarChart } from "./components/BarChart.js";
import { BigIdea } from "./components/BigIdea.js";
import { Checklist } from "./components/Checklist.js";
import { CycleDiagram } from "./components/CycleDiagram.js";
import { Leaderboard } from "./components/Leaderboard.js";
import { PyramidDiagram } from "./components/PyramidDiagram.js";
import { QuoteBlock } from "./components/QuoteBlock.js";
import { StatGrid } from "./components/StatGrid.js";
import { VennDiagram } from "./components/VennDiagram.js";
import type { TimelineAnim } from "./components/timelineTiming.js";

const baseScene = (frame: number) => ({
  startFrame: 0,
  durationInFrames: 90,
  frame,
});

const anims = (targets: string[]): TimelineAnim[] =>
  targets.map((target, i) => ({
    id: target,
    target,
    type: "highlight",
    start: i * 0.5,
    duration: 0.5,
    easing: "easeOut",
  }));

describe("v0.4.2 visual components (renders without throwing)", () => {
  it("QuoteBlock renders quote and attribution", () => {
    const html = renderToStaticMarkup(
      <QuoteBlock
        quote="知之为知之"
        author="孔子"
        {...baseScene(30)}
      />,
    );
    expect(html).toContain("知之为知之");
    expect(html).toContain("孔子");
  });

  it("StatGrid counts up: value is partial at frame 0 and final late", () => {
    const early = renderToStaticMarkup(
      <StatGrid
        stats={[{ value: "85%", label: "准确率" }]}
        {...baseScene(0)}
      />,
    );
    expect(early).toContain("准确率");
    expect(early).toContain("0%");
    const late = renderToStaticMarkup(
      <StatGrid
        stats={[{ value: "85%", label: "准确率" }]}
        {...baseScene(60)}
      />,
    );
    expect(late).toContain("85%");
  });

  it("StatGrid renders up to 6 cards in a grid", () => {
    const html = renderToStaticMarkup(
      <StatGrid
        stats={[
          { value: "10x", label: "a" },
          { value: "20x", label: "b" },
          { value: "30x", label: "c" },
          { value: "40x", label: "d" },
        ]}
        {...baseScene(89)}
      />,
    );
    expect(html).toContain("10x");
    expect(html).toContain("40x");
  });

  it("BarChart renders labels and values", () => {
    const html = renderToStaticMarkup(
      <BarChart
        title="语言占比"
        bars={[
          { label: "中文", value: 60, display: "60%" },
          { label: "英文", value: 40, display: "40%" },
        ]}
        {...baseScene(45)}
      />,
    );
    expect(html).toContain("中文");
    expect(html).toContain("60%");
    expect(html).toContain("语言占比");
  });

  it("Leaderboard renders ranked rows with scores", () => {
    const html = renderToStaticMarkup(
      <Leaderboard
        title="Top 2"
        entries={[
          { name: "Alpha", score: "98" },
          { name: "Beta", score: "91" },
        ]}
        {...baseScene(60)}
      />,
    );
    expect(html).toContain("Alpha");
    expect(html).toContain("98");
    expect(html).toContain("Top 2");
  });

  it("Checklist strokes check marks and text", () => {
    const html = renderToStaticMarkup(
      <Checklist
        items={[{ text: "先写测试" }, { text: "再实现" }]}
        {...baseScene(40)}
      />,
    );
    expect(html).toContain("先写测试");
    expect(html).toContain("再实现");
    // pathLength-based stroke draw must be present.
    expect(html).toContain("stroke-dashoffset");
  });

  it("BigIdea reveals tokens by frame", () => {
    const early = renderToStaticMarkup(
      <BigIdea text="简单优于复杂" kicker="核心观点" {...baseScene(0)} />,
    );
    expect(early).toContain("核心观点");
    const late = renderToStaticMarkup(
      <BigIdea text="简单优于复杂" kicker="核心观点" {...baseScene(60)} />,
    );
    expect(late).toContain("简");
    expect(late).toContain("杂");
  });

  it("PyramidDiagram renders levels as SVG polygons", () => {
    const html = renderToStaticMarkup(
      <PyramidDiagram levels={["总结", "方法", "事实"]} {...baseScene(50)} />,
    );
    expect(html).toContain("总结");
    expect(html).toContain("方法");
    expect(html).toContain("事实");
    expect(html).toContain("<polygon");
  });

  it("VennDiagram renders 3 overlapping circles + center label", () => {
    const html = renderToStaticMarkup(
      <VennDiagram sets={["AI", "教育", "数据"]} center="个性化" {...baseScene(50)} />,
    );
    expect(html).toContain("AI");
    expect(html).toContain("教育");
    expect(html).toContain("个性化");
    expect((html.match(/<circle/g) ?? []).length).toBe(3);
  });

  it("CycleDiagram renders stages on a rotating ring", () => {
    const html = renderToStaticMarkup(
      <CycleDiagram
        stages={["计划", "执行", "检查", "改进"]}
        title="PDCA"
        {...baseScene(50)}
      />,
    );
    expect(html).toContain("计划");
    expect(html).toContain("改进");
    expect(html).toContain("PDCA");
    expect(html).toContain("stroke-dasharray");
  });

  it("all new components accept animations-driven progress without throwing", () => {
    const a = anims(["__quote__", "__author__"]);
    expect(() =>
      renderToStaticMarkup(
        <QuoteBlock quote="q" author="a" animations={a} {...baseScene(0)} />,
      ),
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        <StatGrid
          stats={[{ value: "5", label: "x" }]}
          animations={anims(["stat-0"])}
          {...baseScene(0)}
        />,
      ),
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        <BarChart bars={[{ label: "l", value: 1 }]} animations={anims(["bar-0"])} {...baseScene(0)} />,
      ),
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        <Leaderboard entries={[{ name: "n" }]} animations={anims(["rank-0"])} {...baseScene(0)} />,
      ),
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        <Checklist items={[{ text: "t" }]} animations={anims(["item-0"])} {...baseScene(0)} />,
      ),
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        <BigIdea text="idea" animations={anims(["__reveal__"])} {...baseScene(0)} />,
      ),
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        <PyramidDiagram levels={["a", "b"]} animations={anims(["level-0", "level-1"])} {...baseScene(0)} />,
      ),
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        <VennDiagram sets={["a", "b"]} animations={anims(["set-0", "set-1"])} {...baseScene(0)} />,
      ),
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        <CycleDiagram stages={["a", "b", "c"]} animations={anims(["__ring__", "stage-0"])} {...baseScene(0)} />,
      ),
    ).not.toThrow();
  });
});
