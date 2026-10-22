import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { brandSchema, compileStoryboard, type RenderPlan } from "@video/vdsl";
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

  it("paints the bound scene background behind a non-ImageBackground component", async () => {
    // A loud flat-red JPEG as scene_1's art. If the background layer is
    // not actually drawn behind Title, the frame stays theme-coloured.
    const root = mkdtempSync(path.join(tmpdir(), "video-bg-render-"));
    mkdirSync(path.join(root, "assets", "images"), { recursive: true });
    const jpg = path.join(root, "assets", "images", "scene_1.jpg");
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=320x180",
        "-frames:v",
        "1",
        jpg,
      ],
      { stdio: "ignore" },
    );

    const luma = async (plan: RenderPlan, out: string): Promise<number> => {
      await renderPlanToVideo(plan, out);
      const png = out.replace(/\.mp4$/, "-probe.png");
      execFileSync(
        "ffmpeg",
        ["-y", "-ss", "0.5", "-i", out, "-frames:v", "1", png],
        { stdio: "ignore" },
      );
      const rgb = execFileSync(
        "ffmpeg",
        ["-i", png, "-vf", "format=rgb24", "-f", "rawvideo", "-"],
        { encoding: "buffer", maxBuffer: 1e8 },
      );
      let r = 0;
      let n = 0;
      for (let i = 0; i < rgb.length; i += 3) {
        r += rgb[i]!;
        n++;
      }
      return r / n;
    };

    const oneScene: RenderPlan = {
      ...samplePlan,
      projectRoot: root,
      totalFrames: 60,
      scenes: [{ ...samplePlan.scenes[0]!, durationInFrames: 60 }],
    };

    const outDir = mkdtempSync(path.join(tmpdir(), "video-bg-out-"));
    const withBg = await luma(oneScene, path.join(outDir, "bg.mp4"));
    const withoutBg = await luma(
      { ...oneScene, projectRoot: "/nonexistent" },
      path.join(outDir, "plain.mp4"),
    );
    // The image is pure red, so its presence must pull average red UP.
    expect(withBg).toBeGreaterThan(withoutBg + 20);
  }, 180_000);
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

describe("resolveImageSources — every component gets a scene background", () => {
  /** A real JPEG so imageMime resolves and the byte count is checkable. */
  const projectWithImage = (
    name: string,
    component: string,
  ): { plan: RenderPlan; bytes: number } => {
    const root = mkdtempSync(path.join(tmpdir(), "video-bg-"));
    mkdirSync(path.join(root, "assets", "images"), { recursive: true });
    const file = path.join(root, "assets", "images", `scene_${name}.jpg`);
    const bytes = Buffer.from("ff d8 ff e0 not-really-a-jpeg ff d9", "binary");
    writeFileSync(file, bytes);
    const plan: RenderPlan = {
      ...samplePlan,
      projectRoot: root,
      scenes: [
        {
          ...samplePlan.scenes[0]!,
          id: `scene-${name}`,
          index: Number(name) - 1,
          component,
        },
      ],
    };
    return { plan, bytes: bytes.length };
  };

  it("binds assets/images/scene_N.jpg behind a Title scene", async () => {
    const { plan, bytes } = projectWithImage("7", "Title");
    const resolved = await resolveImageSources(plan);
    const src = resolved.scenes[0]?.backgroundSrc;
    expect(src).toMatch(/^data:image\/jpeg;base64,/);
    expect(Buffer.from(src!.split(",")[1]!, "base64").length).toBe(bytes);
  });

  it("binds the background for EVERY component, not just ImageBackground", async () => {
    for (const component of ["Title", "FlowChart", "Terminal", "Checklist"]) {
      const { plan } = projectWithImage("3", component);
      const resolved = await resolveImageSources(plan);
      expect(resolved.scenes[0]?.backgroundSrc).toMatch(/^data:image\/jpeg;/);
    }
  });

  it("leaves the theme background when no image exists (hand-authored projects)", async () => {
    const resolved = await resolveImageSources({
      ...samplePlan,
      projectRoot: "/nonexistent-project",
      scenes: [{ ...samplePlan.scenes[0]! }],
    });
    expect(resolved.scenes[0]?.backgroundSrc).toBeUndefined();
  });

  it("does nothing without a project root (studio / synthetic plans)", async () => {
    const resolved = await resolveImageSources({
      ...samplePlan,
      scenes: [{ ...samplePlan.scenes[0]! }],
    });
    expect(resolved.scenes[0]?.backgroundSrc).toBeUndefined();
  });

  it("leaves ImageBackground scenes on their own src (no second background)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "video-bg-ib-"));
    mkdirSync(path.join(dir, "assets", "images"), { recursive: true });
    writeFileSync(path.join(dir, "assets", "images", "scene_2.jpg"), "x");
    const own = path.join(dir, "own.png");
    writeFileSync(own, "y");
    const resolved = await resolveImageSources({
      ...samplePlan,
      projectRoot: dir,
      scenes: [
        {
          ...samplePlan.scenes[0]!,
          id: "scene-2",
          component: "ImageBackground",
          props: { src: own },
        },
      ],
    });
    expect(resolved.scenes[0]?.backgroundSrc).toBeUndefined();
    expect(resolved.scenes[0]?.props.src).toMatch(/^data:image\/png;base64,/);
  });
});

describe("compile — background defaults travel with the scene", () => {
  const yaml = (background: string): string => `schema_version: "0.2"
project: {id: t, language: zh-CN, fps: 30, width: 1920, height: 1080}
scenes:
  - id: scene-01
    duration: 4
    visual:
      component: Title
      props: {text: hi}
${background}`;

  it("defaults the scrim on", () => {
    const { renderPlan } = compileStoryboard(yaml(""), "/tmp/p");
    expect(renderPlan.scenes[0]?.backgroundScrim).toBe(true);
  });

  it("honours an explicit scrim: false", () => {
    const { renderPlan } = compileStoryboard(
      yaml("      background: {scrim: false}"),
      "/tmp/p",
    );
    expect(renderPlan.scenes[0]?.backgroundScrim).toBe(false);
  });

  it("carries the project root for background resolution", () => {
    const { renderPlan } = compileStoryboard(yaml(""), "/tmp/proj-x");
    expect(renderPlan.projectRoot).toBe("/tmp/proj-x");
  });
});
