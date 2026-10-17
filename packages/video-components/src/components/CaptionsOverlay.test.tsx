import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaptionsOverlay } from "./CaptionsOverlay.js";
import { ImageBackground } from "./ImageBackground.js";
import { captionFontSize, captionHalo } from "../captionStyle.js";
import { darkTechTheme, paperLightTheme, paperCreamTheme } from "../theme.js";

/**
 * Captions sit on top of an AI-generated image, so the frame behind them is
 * arbitrary and can change on every re-render. They cannot own a legible
 * background any more than they can own a fixed contrast — what has to hold
 * is: no box, no oversized type, and enough separation from whatever
 * happens to be underneath to read at a glance.
 */

const FRAME = { width: 1920, height: 1080 };
const at = (lines: string[], theme = darkTechTheme): string =>
  renderToStaticMarkup(
    <CaptionsOverlay lines={lines} {...FRAME} theme={theme} />,
  );

describe("CaptionsOverlay — no background of its own", () => {
  it("draws no box behind the text", () => {
    const html = at(["字幕"]);
    expect(html).not.toContain("background-color");
    expect(html).not.toContain("backgroundColor");
    // The old implementation painted an opaque plate per line.
    expect(html).not.toContain("rgba(11,18,32");
    expect(html).not.toContain("rgba(11, 18, 32");
  });

  it("still renders every caption line, in order", () => {
    const html = at(["第一行", "第二行"]);
    expect(html.indexOf("第一行")).toBeLessThan(html.indexOf("第二行"));
  });

  it("returns null for an empty caption track", () => {
    expect(at([])).toBe("");
  });
});

describe("CaptionsOverlay — type size", () => {
  it("sets caption type at ~3.2% of frame height (35px at 1080p)", () => {
    // Was 4.2% — 45px at 1080p, which dominated the image it sits on.
    expect(at(["字幕"])).toContain("font-size:35px");
  });

  it("scales with the frame rather than hardcoding pixels", () => {
    const small = renderToStaticMarkup(
      <CaptionsOverlay lines={["字幕"]} width={1280} height={720} />,
    );
    expect(small).toContain("font-size:23px"); // 720 * 0.032
  });
});

describe("CaptionsOverlay — legibility without a plate", () => {
  it("separates light text from the image with a dark outline", () => {
    const html = at(["字幕"]);
    expect(html).toContain("text-shadow");
    // Outline on all four sides plus a soft spread, so the glyph edges
    // separate from any pixel value underneath.
    expect(html).toMatch(/text-shadow:[^"]*0 1px 0/);
    expect(html).toMatch(/text-shadow:[^"]*0 -1px 0/);
    expect(html).toMatch(/text-shadow:[^"]*1px 0 0/);
    expect(html).toMatch(/text-shadow:[^"]*-1px 0 0/);
    expect(html).toContain("rgba(0,0,0");
  });

  it("inverts the halo for dark-ink themes so light text is not the only case", () => {
    // A dark caption on a bright theme needs a light halo, or it
    // disappears into a pale generated image.
    const dark = at(["字幕"], paperLightTheme);
    expect(dark).toContain("rgba(255,255,255");
    expect(dark).not.toContain("rgba(0,0,0");
  });

  it("uses the same treatment for every dark-ink theme", () => {
    expect(at(["字幕"], paperCreamTheme)).toContain("rgba(255,255,255");
  });

  it("keeps the theme's own caption colour", () => {
    expect(at(["字幕"])).toContain(`color:${darkTechTheme.colors.primary}`);
  });

  it("separates with a shadow, not a text stroke", () => {
    // -webkit-text-stroke is painted centred on the glyph edge, so it
    // thins the letterform. CJK horizontals are ~2px at 35px; a 1px
    // stroke cuts a third off them and the caption gets hollow.
    for (const theme of [darkTechTheme, paperLightTheme, paperCreamTheme]) {
      const html = at(["字幕"], theme);
      expect(html, "text-stroke").toContain("text-shadow");
      expect(html.toLowerCase(), "stroke").not.toContain("text-stroke");
      expect(html.toLowerCase(), "stroke").not.toContain("webkittextstroke");
    }
  });
});
describe("ImageBackground's own caption — same treatment as the track", () => {
  // Every ImageBackground scene in the shipped projects carries a caption
  // prop (make copies AnimatedIllustration's text into it), so this second
  // caption path is live on image scenes, not dead code. It used to draw at
  // 48px with an accent glow while the track drew at 45px on a plate.
  const render = (theme = darkTechTheme, height = 1080): string =>
    renderToStaticMarkup(
      <ImageBackground
        src="data:image/gif;base64,R0lGODlhAQABAAAAACw="
        caption="一个技能 = 一个文件夹"
        startFrame={0}
        durationInFrames={60}
        frame={30}
        theme={theme}
        height={height}
      />,
    );

  it("no longer draws at the old hardcoded 48px", () => {
    expect(render()).not.toContain("font-size:48px");
    expect(render()).toContain(`font-size:${captionFontSize(1080)}px`);
  });

  it("drops the accent glow for the same legibility halo", () => {
    const html = render();
    expect(html).toContain("text-shadow");
    expect(html).not.toContain(`0 0 24px ${darkTechTheme.colors.accent}`);
    // Byte-identical outline recipe to the overlay track.
    const halo = captionHalo(darkTechTheme.colors.primary);
    for (const layer of halo.split(",")) {
      expect(html).toContain(layer.trim());
    }
  });

  it("scales with the frame height it is given", () => {
    expect(render(darkTechTheme, 720)).toContain(
      `font-size:${captionFontSize(720)}px`,
    );
  });
});
