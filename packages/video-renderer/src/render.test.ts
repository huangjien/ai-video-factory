import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { brandSchema, compileStoryboard, type RenderPlan } from "@video/vdsl";
import { renderPlanToVideo, resolveImageSources, resolveVideoSources } from "./render.js";

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
  it("produces a 1920x1080 30fps MP4 from a relative cache without removing older bundles", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "video-render-"));
    const mp4Path = path.join(outDir, "out.mp4");
    const cache = path.join(outDir, "cache");
    vi.stubEnv("VIDEO_BUNDLE_CACHE", path.relative(process.cwd(), cache));
    try {
      writeFileSync(cache, "temporary file blocking the cache directory");
      await expect(renderPlanToVideo(samplePlan, mp4Path)).rejects.toThrow();
      rmSync(cache);
      const olderBundle = path.join(cache, "bundle-older");
      mkdirSync(olderBundle, { recursive: true });
      const older = new Date(Date.now() - 31 * 86_400_000);
      utimesSync(olderBundle, older, older);
      await renderPlanToVideo(samplePlan, mp4Path);
      expect(existsSync(olderBundle)).toBe(true);
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
    } finally {
      vi.unstubAllEnvs();
      rmSync(outDir, { recursive: true, force: true });
    }
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

  it("gives a Title scene the art as a prop (it paints its own picture)", async () => {
    // The title card needs the picture's pixels to pick an ink that
    // reads on them, so it takes the art as a prop instead of as the
    // scene background layer.
    const { plan, bytes } = projectWithImage("7", "Title");
    const resolved = await resolveImageSources(plan);
    const src = resolved.scenes[0]?.props["artSrc"];
    expect(src).toMatch(/^data:image\/jpeg;base64,/);
    expect(Buffer.from(String(src).split(",")[1]!, "base64").length).toBe(bytes);
    expect(resolved.scenes[0]?.backgroundSrc).toBeUndefined();
  });

  it("inlines the vendored artistic font for a Title scene", async () => {
    // The browser can only read what the entry embeds, so the face is
    // inlined from the workspace's shared `assets/fonts/`.
    const ws = mkdtempSync(path.join(tmpdir(), "video-fonts-"));
    const root = path.join(ws, "projects", "fixture");
    mkdirSync(path.join(root, "assets", "images"), { recursive: true });
    mkdirSync(path.join(ws, "assets", "fonts"), { recursive: true });
    writeFileSync(path.join(root, "assets", "images", "scene_1.jpg"), "x");
    writeFileSync(
      path.join(ws, "assets", "fonts", "LXGWWenKai-Regular.ttf"),
      "font-bytes",
    );
    const resolved = await resolveImageSources({
      ...samplePlan,
      projectRoot: root,
      scenes: [{ ...samplePlan.scenes[0]!, props: { text: "题" } }],
    });
    const font = resolved.scenes[0]?.props["fontSrc"];
    expect(font).toMatch(/^data:font\/ttf;base64,/);
    expect(
      Buffer.from(String(font).split(",")[1]!, "base64").toString("utf8"),
    ).toBe("font-bytes");
  });

  it("binds the background for EVERY component, not just ImageBackground", async () => {
    for (const component of ["CodeBlock", "Paragraph", "DoodleScene"]) {
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

describe("resolveVideoSources — clips copy into the bundler public dir", () => {
  it("rewrites videoSrc to the served name and copies the bytes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vf-videosrc-"));
    const publicDir = path.join(root, "public");
    const clip = path.join(root, "scene_1.mp4");
    writeFileSync(clip, Buffer.from([0x66, 0x74, 0x79, 0x70])); // ftyp magic
    const plan: RenderPlan = {
      ...samplePlan,
      projectRoot: root,
      scenes: [
        {
          ...samplePlan.scenes[1]!,
          id: "scene-02",
          component: "VideoBackground",
          props: { videoSrc: clip },
        },
      ],
    };
    const warnings: string[] = [];
    const resolved = await resolveVideoSources(plan, publicDir, (m) =>
      warnings.push(m),
    );
    expect(warnings).toEqual([]);
    const served = resolved.scenes[0]?.props.videoSrc;
    expect(served).toBe("scene-video-scene-02.mp4");
    expect(existsSync(path.join(publicDir, served as string))).toBe(true);
  });

  it("copies an identical source path once and shares the served name", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vf-videosrc-"));
    const publicDir = path.join(root, "public");
    const clip = path.join(root, "same.mp4");
    writeFileSync(clip, Buffer.from([0x66, 0x74, 0x79, 0x70]));
    const videoScene = (id: string) => ({
      ...samplePlan.scenes[1]!,
      id,
      component: "VideoBackground" as const,
      props: { videoSrc: clip },
    });
    const plan: RenderPlan = {
      ...samplePlan,
      scenes: [videoScene("scene-01"), videoScene("scene-02")],
    };
    const resolved = await resolveVideoSources(plan, publicDir);
    expect(resolved.scenes[0]?.props.videoSrc).toBe(
      resolved.scenes[1]?.props.videoSrc,
    );
    const served = readdirSync(publicDir);
    expect(served).toHaveLength(1);
  });

  it("warns and leaves the scene untouched when the clip is missing", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vf-videosrc-"));
    const publicDir = path.join(root, "public");
    const plan: RenderPlan = {
      ...samplePlan,
      scenes: [
        {
          ...samplePlan.scenes[1]!,
          component: "VideoBackground",
          props: { videoSrc: path.join(root, "nope.mp4") },
        },
      ],
    };
    const warnings: string[] = [];
    const resolved = await resolveVideoSources(plan, publicDir, (m) =>
      warnings.push(m),
    );
    expect(warnings.join("\n")).toMatch(/videoSrc not found/);
    expect(existsSync(publicDir)).toBe(false);
    expect(resolved.scenes[0]?.props.videoSrc).toMatch(/nope\.mp4$/);
  });
});

describe("resolveImageSources — a placed clip promotes the scene to VideoBackground", () => {
  it("swaps ImageBackground for VideoBackground when assets/video/scene_N.mp4 exists", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vf-videobind-"));
    mkdirSync(path.join(root, "assets", "video"), { recursive: true });
    const clip = path.join(root, "assets", "video", "scene_1.mp4");
    writeFileSync(clip, Buffer.from([0x66, 0x74, 0x79, 0x70]));
    const imageScene = {
      ...samplePlan.scenes[1]!,
      id: "scene-01",
      component: "ImageBackground" as const,
      props: { src: path.join(root, "assets", "images", "scene_1.jpg") },
    };
    const plan: RenderPlan = {
      ...samplePlan,
      projectRoot: root,
      scenes: [imageScene],
    };
    const resolved = await resolveImageSources(plan);
    expect(resolved.scenes[0]?.component).toBe("VideoBackground");
    expect(resolved.scenes[0]?.props.videoSrc).toBe(clip);
  });

  it("keeps ImageBackground (and its data URL) when no clip exists", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vf-videobind-"));
    mkdirSync(path.join(root, "assets", "images"), { recursive: true });
    const jpg = path.join(root, "assets", "images", "scene_1.jpg");
    writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const imageScene = {
      ...samplePlan.scenes[1]!,
      id: "scene-01",
      component: "ImageBackground" as const,
      props: { src: jpg },
    };
    const plan: RenderPlan = {
      ...samplePlan,
      projectRoot: root,
      scenes: [imageScene],
    };
    const resolved = await resolveImageSources(plan);
    expect(resolved.scenes[0]?.component).toBe("ImageBackground");
    expect(resolved.scenes[0]?.props.src).toMatch(/^data:image\/jpeg;base64,/);
  });
});

describe("M1 — a placed PD clip renders as the scene background", () => {
  it(
    "binds assets/video/scene_1.mp4 through OffthreadVideo and paints it",
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), "vf-m1-"));
      mkdirSync(path.join(root, "assets", "video"), { recursive: true });
      // Loud flat-blue 3 s clip — if the video layer is not actually
      // composited, the frame stays theme-coloured (dark, low blue).
      const clip = path.join(root, "assets", "video", "scene_1.mp4");
      execFileSync(
        "ffmpeg",
        ["-y", "-f", "lavfi", "-i", "color=c=blue:s=540x960:r=30", "-t", "3", clip],
        { stdio: "ignore" },
      );
      const imageScene = {
        ...samplePlan.scenes[0]!,
        id: "scene-01",
        component: "ImageBackground" as const,
        props: { src: path.join(root, "nowhere.jpg") },
      };
      const plan: RenderPlan = {
        ...samplePlan,
        projectRoot: root,
        totalFrames: 60,
        scenes: [{ ...imageScene, durationInFrames: 60 }],
      };

      const meanChannels = async (out: string): Promise<[number, number, number]> => {
        await renderPlanToVideo(plan, out);
        const png = out.replace(/\.mp4$/, "-probe.png");
        execFileSync("ffmpeg", ["-y", "-ss", "0.5", "-i", out, "-frames:v", "1", png], {
          stdio: "ignore",
        });
        const rgb = execFileSync(
          "ffmpeg",
          ["-i", png, "-vf", "format=rgb24", "-f", "rawvideo", "-"],
          { encoding: "buffer", maxBuffer: 1e8 },
        );
        let r = 0;
        let g = 0;
        let b = 0;
        const n = rgb.length / 3;
        for (let i = 0; i < rgb.length; i += 3) {
          r += rgb[i]!;
          g += rgb[i + 1]!;
          b += rgb[i + 2]!;
        }
        return [r / n, g / n, b / n];
      };

      const outDir = mkdtempSync(path.join(tmpdir(), "vf-m1-out-"));
      const [r, g, b] = await meanChannels(path.join(outDir, "clip.mp4"));
      // Blue-dominant frame: the clip's pixels, not the theme's.
      expect(b).toBeGreaterThan(120);
      expect(b).toBeGreaterThan(r + 40);
      expect(b).toBeGreaterThan(g + 40);
      // And the scrim still keeps the lower third darker than the top.
      const png = path.join(outDir, "clip-probe.png");
      const top = execFileSync(
        "ffmpeg",
        ["-i", png, "-vf", "format=rgb24,crop=1080:300:0:0", "-f", "rawvideo", "-"],
        { encoding: "buffer", maxBuffer: 1e8 },
      );
      const bottom = execFileSync(
        "ffmpeg",
        ["-i", png, "-vf", "format=rgb24,crop=1080:300:0:1620", "-f", "rawvideo", "-"],
        { encoding: "buffer", maxBuffer: 1e8 },
      );
      const mean = (buf: Buffer): number => {
        let s = 0;
        for (let i = 0; i < buf.length; i++) s += buf[i]!;
        return s / buf.length;
      };
      expect(mean(bottom)).toBeLessThan(mean(top));
    },
    180_000,
  );
});
