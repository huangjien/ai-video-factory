import { describe, expect, it } from "vitest";
import { brandSchema, compileStoryboard, type Storyboard } from "./index.js";

const minimalBoard = (style: Record<string, unknown>): string =>
  [
    "schema_version: \"0.2\"",
    "project:",
    "  id: demo",
    "  language: zh-CN",
    "  fps: 30",
    "  width: 1920",
    "  height: 1080",
    `style: ${JSON.stringify(style)}`,
    "scenes:",
    "  - id: scene-01",
    "    duration: 8",
    "    narration:",
    "      text: 第一段",
    "    visual:",
    "      component: Title",
    "      props:",
    "        text: 标题",
  ].join("\n");

describe("brandSchema", () => {
  it("applies marketing defaults when intro is declared (bottom-right, 72px, 15s aurora)", () => {
    const b = brandSchema.parse({ name: "我的频道", intro: {} });
    expect(b.corner).toBe("bottom-right");
    expect(b.size_px).toBe(72);
    expect(b.opacity).toBe(0.85);
    expect(b.intro?.duration_sec).toBe(15);
    expect(b.intro?.background).toBe("aurora");
    expect(b.intro?.show_name).toBe(true);
  });

  it("omitting intro means no branded opening (icon-only branding)", () => {
    const b = brandSchema.parse({ name: "我的频道" });
    expect(b.intro).toBeUndefined();
  });

  it("accepts a full brand block", () => {
    const b = brandSchema.parse({
      name: "Channel",
      icon: "assets/brand/icon.png",
      corner: "top-left",
      size_px: 96,
      opacity: 0.5,
      intro: { duration_sec: 20, background: "sunset", show_name: false },
    });
    expect(b.corner).toBe("top-left");
    expect(b.intro?.duration_sec).toBe(20);
  });

  it("rejects unknown corners and out-of-range values", () => {
    expect(brandSchema.safeParse({ corner: "middle" }).success).toBe(false);
    expect(brandSchema.safeParse({ size_px: 9999 }).success).toBe(false);
    expect(brandSchema.safeParse({ opacity: 0 }).success).toBe(false);
  });
});

describe("storyboard style.brand passthrough", () => {
  it("compile carries the brand block into the RenderPlan", () => {
    const { renderPlan } = compileStoryboard(
      minimalBoard({ theme: "ocean-deep", brand: { name: "品牌", corner: "top-right" } }),
      "/tmp",
    );
    expect(renderPlan.style.brand?.name).toBe("品牌");
    expect(renderPlan.style.brand?.corner).toBe("top-right");
    expect(renderPlan.style.brand?.size_px).toBe(72);
  });

  it("compile omits brand when the storyboard has none", () => {
    const { renderPlan } = compileStoryboard(
      minimalBoard({ theme: "dark-tech" }),
      "/tmp",
    );
    expect(renderPlan.style.brand).toBeUndefined();
  });
});
