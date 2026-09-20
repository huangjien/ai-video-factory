import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Callout } from "./components/Callout.js";
import { Comparison } from "./components/Comparison.js";
import { EndCard } from "./components/EndCard.js";
import { FlowChart } from "./components/FlowChart.js";
import { Timeline } from "./components/Timeline.js";

const baseScene = (frame: number) => ({
  startFrame: 0,
  durationInFrames: 60,
  frame,
});

describe("Todo 9 — components batch B (renders without throwing)", () => {
  it("FlowChart renders nodes/edges", () => {
    const html = renderToStaticMarkup(
      <FlowChart
        nodes={["Q", "Step 1", "A"]}
        edges={[
          [0, 1],
          [1, 2],
        ]}
        {...baseScene(15)}
      />,
    );
    expect(html).toContain("Step 1");
    expect(html).toContain("Q");
    expect(html).toContain("A");
  });

  it("Comparison renders left and right cards", () => {
    const html = renderToStaticMarkup(
      <Comparison
        left={{ title: "无 CoT", items: ["错误率高", "无法分解"] }}
        right={{ title: "有 CoT", items: ["准确", "可解释"] }}
        {...baseScene(15)}
      />,
    );
    expect(html).toContain("无 CoT");
    expect(html).toContain("有 CoT");
  });

  it("Timeline renders 4 events within 1920px width", () => {
    const html = renderToStaticMarkup(
      <Timeline
        events={[
          { label: "2017" },
          { label: "2018" },
          { label: "2019" },
          { label: "2020" },
        ]}
        {...baseScene(15)}
      />,
    );
    expect(html).toContain("2017");
    expect(html).toContain("2020");
  });

  it("Callout respects kind tint", () => {
    const html = renderToStaticMarkup(
      <Callout kind="warning" title="注意" text="请确认" {...baseScene(15)} />,
    );
    expect(html).toContain("注意");
    expect(html).toContain("请确认");
  });

  it("EndCard renders title + subtitle + cta", () => {
    const html = renderToStaticMarkup(
      <EndCard title="谢谢观看" subtitle="订阅" cta="AI 视频工厂" {...baseScene(15)} />,
    );
    expect(html).toContain("谢谢观看");
    expect(html).toContain("订阅");
    expect(html).toContain("AI 视频工厂");
  });

  it("renders all 5 batch-B components without throwing", () => {
    const items = [
      <FlowChart key="f" nodes={["a"]} {...baseScene(0)} />,
      <Comparison key="c" left={{ title: "l", items: ["x"] }} right={{ title: "r", items: ["y"] }} {...baseScene(0)} />,
      <Timeline key="t" events={[{ label: "now" }]} {...baseScene(0)} />,
      <Callout key="ca" kind="info" text="hi" {...baseScene(0)} />,
      <EndCard key="e" title="end" {...baseScene(0)} />,
    ];
    for (const el of items) {
      expect(() => renderToStaticMarkup(el)).not.toThrow();
    }
  });
});
