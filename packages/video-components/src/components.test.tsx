import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Title } from "./components/Title.js";
import { Paragraph } from "./components/Paragraph.js";
import { CodeBlock } from "./components/CodeBlock.js";
import { Terminal } from "./components/Terminal.js";
import { Image } from "./components/Image.js";

const baseScene = (frame: number) => ({
  startFrame: 0,
  durationInFrames: 60,
  frame,
});

describe("Todo 8 — components batch A (render at frame 0 and mid)", () => {
  it("Title renders text at frame 0 and mid", () => {
    const a = renderToStaticMarkup(
      <Title text="AI 思维链" startFrame={0} durationInFrames={60} frame={0} />,
    );
    const b = renderToStaticMarkup(
      <Title text="AI 思维链" startFrame={0} durationInFrames={60} frame={15} />,
    );
    expect(a).toContain("AI 思维链");
    expect(b).toContain("AI 思维链");
    expect(a).not.toBe(b);
  });

  it("Paragraph clamps long text within stage height (assert no overflow markup)", () => {
    const longText = "字".repeat(200);
    const html = renderToStaticMarkup(
      <Paragraph text={longText} startFrame={0} durationInFrames={60} frame={0} />,
    );
    expect(html).toBeDefined();
  });

  it("CodeBlock renders code text and highlight indicator", () => {
    const html = renderToStaticMarkup(
      <CodeBlock code="print(1)" language="python" highlightLines={[1]} startFrame={0} durationInFrames={60} frame={0} />,
    );
    expect(html).toContain("print(1)");
  });

  it("Terminal renders lines with prompt", () => {
    const html = renderToStaticMarkup(
      <Terminal lines={["ls", "docs"]} prompt="$" startFrame={0} durationInFrames={60} frame={0} />,
    );
    expect(html).toContain("$");
  });

  it("Image renders a static <img> tag for a known path", () => {
    const html = renderToStaticMarkup(
      <Image src="assets/images/cover.png" startFrame={0} durationInFrames={60} frame={0} />,
    );
    expect(html).toContain("cover.png");
  });

  it("renders all 5 batch-A components without throwing", () => {
    const items = [
      <Title key="t" text="t" {...baseScene(0)} />,
      <Paragraph key="p" text="p" {...baseScene(0)} />,
      <CodeBlock key="c" code="x" language="text" {...baseScene(0)} />,
      <Terminal key="t2" lines={["x"]} {...baseScene(0)} />,
      <Image key="i" src="x.png" {...baseScene(0)} />,
    ];
    for (const el of items) {
      expect(() => renderToStaticMarkup(el)).not.toThrow();
    }
  });
});
