import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BrandConfig } from "@video/vdsl";
import {
  BrandWatermark,
  INTRO_GRADIENTS,
  cornerStyle,
  introGradient,
  introWindowActive,
} from "./BrandOverlay.js";

describe("cornerStyle", () => {
  const w = 1920;
  const h = 1080;
  it("pins the watermark to each corner with the same margin", () => {
    const margin = Math.round(Math.min(w, h) * 0.028); // 30px
    const tl = cornerStyle("top-left", 72, w, h);
    expect(tl.top).toBe(margin);
    expect(tl.left).toBe(margin);
    const tr = cornerStyle("top-right", 72, w, h);
    expect(tr.top).toBe(margin);
    expect(tr.right).toBe(margin);
    const bl = cornerStyle("bottom-left", 72, w, h);
    expect(bl.bottom).toBe(margin);
    expect(bl.left).toBe(margin);
    const br = cornerStyle("bottom-right", 72, w, h);
    expect(br.bottom).toBe(margin);
    expect(br.right).toBe(margin);
  });

  it("never sets opposite edges on the same axis", () => {
    for (const c of [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ] as const) {
      const s = cornerStyle(c, 72, w, h);
      expect(s.top === undefined || s.bottom === undefined).toBe(true);
      expect(s.left === undefined || s.right === undefined).toBe(true);
    }
  });
});

describe("introWindowActive", () => {
  it("is true inside the window and false after it", () => {
    expect(introWindowActive(0, 30, 15)).toBe(true);
    expect(introWindowActive(14 * 30, 30, 15)).toBe(true);
    expect(introWindowActive(15 * 30, 30, 15)).toBe(false);
    expect(introWindowActive(120 * 30, 30, 15)).toBe(false);
  });
});

describe("introGradient", () => {
  it("covers every named background and falls back to aurora", () => {
    for (const name of ["aurora", "sunset", "ocean", "citrus"]) {
      const g = introGradient(name);
      expect(g.band).toMatch(/linear-gradient/);
      expect(g.tint).toMatch(/linear-gradient/);
      expect(Object.keys(INTRO_GRADIENTS)).toContain(name);
    }
    expect(introGradient("nope").band).toBe(INTRO_GRADIENTS["aurora"]!.band);
  });
});

describe("BrandWatermark — the per-scene corner mark can be switched off (CS-08)", () => {
  const brand = (extra: Partial<BrandConfig>): BrandConfig =>
    ({
      name: "频道",
      icon: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      corner: "bottom-right",
      size_px: 72,
      opacity: 0.85,
      watermark: true,
      ...extra,
    }) as BrandConfig;

  it("draws the mark by default", () => {
    const html = renderToStaticMarkup(
      <BrandWatermark brand={brand({})} width={1920} height={1080} />,
    );
    expect(html).toContain("<img");
  });

  it("draws nothing when the watermark is off, even with an icon set", () => {
    const html = renderToStaticMarkup(
      <BrandWatermark
        brand={brand({ watermark: false })}
        width={1920}
        height={1080}
      />,
    );
    expect(html).toBe("");
  });

  it("draws nothing without an icon, as before", () => {
    const html = renderToStaticMarkup(
      <BrandWatermark
        brand={brand({ icon: undefined })}
        width={1920}
        height={1080}
      />,
    );
    expect(html).toBe("");
  });
});
