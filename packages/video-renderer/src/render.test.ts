import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { brandSchema, type RenderPlan } from "@video/vdsl";
import { renderPlanToVideo, resolveImageSources } from "./render.js";

const samplePlan: RenderPlan = {
  project: {
    id: "fixture",
    language: "zh-CN",
    fps: 30,
    width: 1920,
    height: 1080,
  },
  style: { theme: "dark-tech" },
  totalFrames: 210,
  scenes: [
    {
      id: "scene-01",
      index: 0,
      startFrame: 0,
      durationInFrames: 90,
      component: "Title",
      renderer: "remotion",
      props: { text: "测试 1" },
      animation: { entrance: "fade", emphasis: "none", exit: "none" },
      animations: [],
      transition: null,
      captions: null,
      audio: null,
    },
    {
      id: "scene-02",
      index: 1,
      startFrame: 90,
      durationInFrames: 120,
      component: "Paragraph",
      renderer: "remotion",
      props: { text: "测试 2" },
      animation: { entrance: "fade", emphasis: "none", exit: "none" },
      animations: [],
      transition: null,
      captions: null,
      audio: null,
    },
  ],
};

describe("renderPlanToVideo (todo 10)", () => {
  it("produces a 1920x1080 30fps MP4 with duration ~7s", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "video-render-"));
    const mp4Path = path.join(outDir, "out.mp4");
    await renderPlanToVideo(samplePlan, mp4Path);
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,duration",
        "-of",
        "json",
        mp4Path,
      ],
      { encoding: "utf8" },
    );
    const s = JSON.parse(out).streams[0];
    expect(s.width).toBe(1920);
    expect(s.height).toBe(1080);
    expect(s.r_frame_rate).toBe("30/1");
    expect(Math.abs(parseFloat(s.duration) - 7.0)).toBeLessThan(0.2);
  }, 120_000);
});

describe("resolveImageSources — missing assets warn, mimes are honest", () => {
  const imageScene = (src: string): RenderPlan => ({
    ...samplePlan,
    scenes: [
      {
        ...samplePlan.scenes[0]!,
        id: "scene-img",
        component: "ImageBackground",
        props: { src },
      },
    ],
  });

  it("warns and keeps the dark-background fallback when src is missing", async () => {
    const warnings: string[] = [];
    const resolved = await resolveImageSources(
      imageScene("/nonexistent/bg.jpg"),
      (m) => warnings.push(m),
    );
    expect(resolved.scenes[0]?.props.src).toBe("/nonexistent/bg.jpg");
    expect(
      warnings.some((m) => m.includes("scene-img") && m.includes("bg.jpg")),
    ).toBe(true);
  });

  it("maps .webp/.avif to their real mime types", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "video-imgsrc-"));
    const cases = [
      ["bg.webp", "image/webp"],
      ["bg.avif", "image/avif"],
    ] as const;
    for (const [name, mime] of cases) {
      const file = path.join(dir, name);
      writeFileSync(file, "x");
      const resolved = await resolveImageSources(imageScene(file));
      expect(resolved.scenes[0]?.props.src).toMatch(
        new RegExp(`^data:${mime};base64,`),
      );
    }
  });

  it("warns when the brand icon is missing (watermark skipped)", async () => {
    const warnings: string[] = [];
    const resolved = await resolveImageSources(
      {
        ...samplePlan,
        style: {
          theme: "dark-tech",
          brand: brandSchema.parse({ icon: "/gone/logo.png" }),
        },
      },
      (m) => warnings.push(m),
    );
    expect(resolved.style.brand?.icon).toBe("/gone/logo.png");
    expect(
      warnings.some((m) => m.includes("brand icon") && m.includes("logo.png")),
    ).toBe(true);
  });
});
