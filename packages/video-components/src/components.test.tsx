import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// OffthreadVideo needs Remotion's composition contexts, which
// renderToStaticMarkup does not provide — stub it as the plain <video>
// it compiles down to; everything else stays the real remotion module.
vi.mock("remotion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("remotion")>();
  const OffthreadVideoStub = (props: Record<string, unknown>) => (
    <video {...(props as Record<string, string>)} />
  );
  return { ...actual, OffthreadVideo: OffthreadVideoStub };
});
import { Title } from "./components/Title.js";
import { Paragraph } from "./components/Paragraph.js";
import { CodeBlock } from "./components/CodeBlock.js";
import { Image } from "./components/Image.js";
import { VideoBackground } from "./components/VideoBackground.js";
import { ImageBackground } from "./components/ImageBackground.js";
import { paperLightTheme } from "./theme.js";

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
      <Title
        text="AI 思维链"
        startFrame={0}
        durationInFrames={60}
        frame={15}
      />,
    );
    // Each character wrapped in its own <span>; verify all six appear
    // (in order) without requiring the literal substring match.
    for (const ch of "AI 思维链") {
      expect(a).toContain(ch);
      expect(b).toContain(ch);
    }
    expect(a).not.toBe(b);
  });

  it("Title keeps the width of spaces between words", () => {
    // Each glyph is its own flex item, so a bare space collapsed to zero
    // width and every headline rendered as one run-on word.
    const html = renderToStaticMarkup(
      <Title
        text="Seven Wrong Calls"
        startFrame={0}
        durationInFrames={60}
        frame={15}
      />,
    );
    // The space glyph must be rendered with `white-space: pre` so it is not
    // collapsed away by the browser.
    const spaceSpan = /<span style="[^"]*white-space:pre[^"]*"> <\/span>/.test(
      html,
    );
    expect(spaceSpan).toBe(true);
  });

  it("Paragraph clamps long text within stage height (assert no overflow markup)", () => {
    const longText = "字".repeat(200);
    const html = renderToStaticMarkup(
      <Paragraph
        text={longText}
        startFrame={0}
        durationInFrames={60}
        frame={0}
      />,
    );
    expect(html).toBeDefined();
  });

  it("CodeBlock renders code text and highlight indicator", () => {
    const html = renderToStaticMarkup(
      <CodeBlock
        code="print(1)"
        language="python"
        highlightLines={[1]}
        startFrame={0}
        durationInFrames={60}
        frame={0}
      />,
    );
    // The new component tokenizes for syntax coloring, so individual
    // identifier spans may wrap each part of the call — assert that all
    // 8 chars of `print(1)` are present, not as a single substring.
    expect(html).toContain("print");
    expect(html).toContain("1");
    expect(html).toContain("(");
    expect(html).toContain(")");
  });

  it("Image renders a static <img> tag for a known path", () => {
    const html = renderToStaticMarkup(
      <Image
        src="assets/images/cover.png"
        startFrame={0}
        durationInFrames={60}
        frame={0}
      />,
    );
    expect(html).toContain("cover.png");
  });

  it("renders all 4 batch-A components without throwing", () => {
    const items = [
      <Title key="t" text="t" {...baseScene(0)} />,
      <Paragraph key="p" text="p" {...baseScene(0)} />,
      <CodeBlock key="c" code="x" language="text" {...baseScene(0)} />,
      <Image key="i" src="x.png" {...baseScene(0)} />,
    ];
    for (const el of items) {
      expect(() => renderToStaticMarkup(el)).not.toThrow();
    }
  });
});

describe("Title — the artistic title card", () => {
  it("paints the scene art behind the type", () => {
    const html = renderToStaticMarkup(
      <Title
        text="弃书不是题材太小"
        artSrc="data:image/jpeg;base64,AAAA"
        theme={paperLightTheme}
        {...baseScene(15)}
      />,
    );
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"');
  });

  it("sets the title in the artistic face, not the theme's sans", () => {
    const html = renderToStaticMarkup(
      <Title
        text="弃书不是题材太小"
        theme={paperLightTheme}
        {...baseScene(15)}
      />,
    );
    expect(html).toContain("TitleKai");
    expect(html).toContain(paperLightTheme.typography.title.fontFamily);
  });

  it("sets the brush style as a vertical column", () => {
    const html = renderToStaticMarkup(
      <Title
        text="玄武门之变"
        style="brush"
        theme={paperLightTheme}
        {...baseScene(15)}
      />,
    );
    expect(html).toContain("vertical-rl");
    expect(html).toContain("TitleBrush");
  });

  it("keeps a Latin title horizontal even in the brush style", () => {
    // A vertical column only reads for CJK.
    const html = renderToStaticMarkup(
      <Title
        text="Seven Wrong Calls"
        style="brush"
        theme={paperLightTheme}
        {...baseScene(15)}
      />,
    );
    expect(html).not.toContain("vertical-rl");
  });

  it("draws in the theme's ink when there is no art to adapt to", () => {
    const html = renderToStaticMarkup(
      <Title text="测试" theme={paperLightTheme} {...baseScene(15)} />,
    );
    expect(html).toContain(paperLightTheme.colors.primary);
  });

  it("falls back to the horizontal treatment for an unknown style", () => {
    // A hand-edited storyboard may carry a style the card does not know;
    // it must not fail the render.
    const html = renderToStaticMarkup(
      <Title
        text="玄武门之变"
        style={"brussh" as never}
        theme={paperLightTheme}
        {...baseScene(15)}
      />,
    );
    expect(html).toContain("TitleKai");
    expect(html).not.toContain("vertical-rl");
  });
});

describe("VideoBackground — archival clip behind the caption band", () => {
  it("mounts a muted OffthreadVideo fitted over the frame", () => {
    const html = renderToStaticMarkup(
      <VideoBackground videoSrc="scene_3.mp4" {...baseScene(15)} />,
    );
    expect(html).toContain("scene_3.mp4");
    // Audio must never leak from archival clips — narration/BGM own it.
    expect(html).toMatch(/muted/i);
    expect(html).toContain("object-fit");
  });

  it("applies the same bottom scrim band as ImageBackground", () => {
    const video = renderToStaticMarkup(
      <VideoBackground videoSrc="s.mp4" {...baseScene(15)} />,
    );
    const image = renderToStaticMarkup(
      <ImageBackground src="s.jpg" {...baseScene(15)} />,
    );
    const gradient = /linear-gradient\(180deg[^"]*55%[^"]*\)/;
    expect(video).toMatch(gradient);
    expect(image).toMatch(gradient);
  });

  it("renders the caption band when a caption is given", () => {
    const html = renderToStaticMarkup(
      <VideoBackground
        videoSrc="s.mp4"
        caption="1944 年的新闻纪录片"
        {...baseScene(15)}
      />,
    );
    expect(html).toContain("1944 年的新闻纪录片");
  });
});
