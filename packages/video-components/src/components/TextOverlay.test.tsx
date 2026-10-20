import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TextOverlay, overlayOpacity } from "./TextOverlay.js";
import { paperCreamTheme, darkTechTheme } from "../theme.js";

describe("overlayOpacity (CS-06)", () => {
  it("is 0 outside the window and 1 in the middle of it", () => {
    expect(overlayOpacity(0, 1, 5)).toBe(0);
    expect(overlayOpacity(3, 1, 5)).toBe(1);
    expect(overlayOpacity(6, 1, 5)).toBe(0);
  });

  it("ramps in and out instead of popping", () => {
    expect(overlayOpacity(1, 1, 5)).toBe(0);
    expect(overlayOpacity(1.3, 1, 5)).toBeGreaterThan(0);
    expect(overlayOpacity(1.3, 1, 5)).toBeLessThan(1);
    expect(overlayOpacity(4.7, 1, 5)).toBeGreaterThan(0);
    expect(overlayOpacity(4.7, 1, 5)).toBeLessThan(1);
  });
});

describe("TextOverlay (CS-06)", () => {
  const base = {
    startSec: 1,
    endSec: 5,
    sceneSec: 3,
    width: 1920,
    height: 1080,
  };

  it("renders nothing outside its window", () => {
    const html = renderToStaticMarkup(
      <TextOverlay {...base} title="片名" sceneSec={0.5} />,
    );
    expect(html).toBe("");
  });

  it("renders the title inside the window", () => {
    const html = renderToStaticMarkup(<TextOverlay {...base} title="片名" />);
    expect(html).toContain("片名");
  });

  it("renders a chapter name", () => {
    const html = renderToStaticMarkup(
      <TextOverlay {...base} chapter="第一章" />,
    );
    expect(html).toContain("第一章");
  });

  it("renders nothing when it carries neither a title nor a chapter", () => {
    const html = renderToStaticMarkup(<TextOverlay {...base} />);
    expect(html).toBe("");
  });

  it("uses the theme's own sans-serif face — never a brush face", () => {
    const html = renderToStaticMarkup(
      <TextOverlay {...base} title="片名" theme={paperCreamTheme} />,
    );
    expect(html).toContain(paperCreamTheme.typography.title.fontFamily);
    expect(html).not.toMatch(/kaiti|楷|brush|calligraph/i);
  });

  it("draws no plate behind the text", () => {
    const html = renderToStaticMarkup(
      <TextOverlay {...base} title="片名" theme={darkTechTheme} />,
    );
    expect(html).not.toContain("background-color");
  });

  it("keeps the title and the chapter independently optional", () => {
    const titleOnly = renderToStaticMarkup(
      <TextOverlay {...base} title="片名" />,
    );
    expect(titleOnly).toContain("片名");
    expect(titleOnly).not.toContain("第一章");
  });
});
