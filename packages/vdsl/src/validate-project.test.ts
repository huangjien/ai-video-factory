import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod/v3";
import type { ComponentRegistry } from "./validate-project.js";
import { validateProject } from "./validate-project.js";
import { validStoryboardYaml } from "./test-fixtures.js";

const registry: ComponentRegistry = {
  Title: { propsSchema: z.object({ text: z.string().min(1) }).strict() },
  Paragraph: {
    propsSchema: z.object({ text: z.string().min(1) }).strict(),
  },
  Image: {
    propsSchema: z
      .object({ src: z.string().min(1), fit: z.enum(["contain", "cover"]) })
      .strict(),
  },
  ImageBackground: {
    propsSchema: z
      .object({ src: z.string().min(1), caption: z.string().optional() })
      .strict(),
  },
  DoodleScene: { propsSchema: z.object({}).passthrough() },
};

function fixtureProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "video-proj-"));
  mkdirSync(path.join(root, "assets", "audio"), { recursive: true });
  mkdirSync(path.join(root, "assets", "images"), { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-t",
      "5",
      path.join(root, "assets/audio/scene-01.wav"),
    ],
    { stdio: "ignore" },
  );
  writeFileSync(path.join(root, "assets/images/pic.png"), "png");
  return root;
}

const okProbe = async () => 4.0;

describe("validateProject — §21.1 lines 926-930", () => {
  it("accepts a fully valid project (registry+assets+audio)", async () => {
    const root = fixtureProject();
    const result = await validateProject(
      validStoryboardYaml,
      "storyboard.yaml",
      {
        projectRoot: root,
        registry,
        probeAudio: okProbe,
      },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an unregistered component naming scene + component", async () => {
    const yamlText = validStoryboardYaml.replace(
      "component: Paragraph",
      "component: Hologram",
    );
    const result = await validateProject(yamlText, "storyboard.yaml", {
      projectRoot: fixtureProject(),
      registry,
      probeAudio: okProbe,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) =>
        e.field.includes("visual.component"),
      );
      expect(err?.message).toContain("Hologram");
      expect(err?.message).toMatch(/registry|registered/);
      expect(err?.field).toContain("scenes.1");
    }
  });

  it("rejects props that fail the registry schema", async () => {
    const yamlText = validStoryboardYaml.replace(
      '        text: "因为上下文会丢失。"',
      '        text: ""',
    );
    const result = await validateProject(yamlText, "storyboard.yaml", {
      projectRoot: fixtureProject(),
      registry,
      probeAudio: okProbe,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.field.startsWith("scenes.1.visual.props")),
      ).toBe(true);
    }
  });

  it("rejects a missing narration.audio file with the path", async () => {
    const yamlText = validStoryboardYaml.replace(
      "audio: assets/audio/scene-01.wav",
      "audio: assets/audio/missing.wav",
    );
    const result = await validateProject(yamlText, "storyboard.yaml", {
      projectRoot: fixtureProject(),
      registry,
      probeAudio: okProbe,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) =>
        e.field.includes("narration.audio"),
      );
      expect(err?.message).toContain("assets/audio/missing.wav");
    }
  });

  it("rejects audio longer than the scene duration (expected vs actual)", async () => {
    const result = await validateProject(
      validStoryboardYaml,
      "storyboard.yaml",
      {
        projectRoot: fixtureProject(),
        registry,
        probeAudio: async () => 8.6,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) =>
        e.field.includes("narration.audio"),
      );
      expect(err?.message).toMatch(/8\.6.*8(\.0)?|longer/i);
    }
  });

  it("accepts audio within tolerance (<= duration + 0.05)", async () => {
    const result = await validateProject(
      validStoryboardYaml,
      "storyboard.yaml",
      {
        projectRoot: fixtureProject(),
        registry,
        probeAudio: async () => 8.04,
      },
    );
    expect(result.ok).toBe(true);
  });

  it("splits long caption text into safe timed cues", async () => {
    const longText = "字".repeat(100);
    const yamlText = validStoryboardYaml.replaceAll(
      "AI Agent 为什么需要 Memory？",
      longText,
    );
    const result = await validateProject(yamlText, "storyboard.yaml", {
      projectRoot: fixtureProject(),
      registry,
      probeAudio: okProbe,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts long narration when captions are rendered as timed cues", async () => {
    const narration =
      "先秦征发扩大了国家的动员能力，也让普通家庭承担更多兵役与运输负担。".repeat(
        4,
      );
    const yamlText = `schema_version: "0.2"
project: {id: long-narration, language: zh-CN, fps: 30, width: 1920, height: 1080}
scenes:
  - id: scene-01
    duration: 24
    narration: {text: "${narration}"}
    visual: {component: Title, props: {text: "户籍扩大征发能力"}}
    captions: {source: narration}
`;
    const result = await validateProject(yamlText, "storyboard.yaml", {
      projectRoot: fixtureProject(),
      registry,
      probeAudio: okProbe,
    });

    expect(result.ok).toBe(true);
  });

  it("checks image props.src existence", async () => {
    const yamlText = validStoryboardYaml.replace(
      'component: Paragraph\n      props:\n        text: "因为上下文会丢失。"',
      'component: Image\n      props:\n        src: "assets/images/gone.png"\n        fit: contain',
    );
    const result = await validateProject(yamlText, "storyboard.yaml", {
      projectRoot: fixtureProject(),
      registry,
      probeAudio: okProbe,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes("gone.png"))).toBe(
        true,
      );
    }
  });

  it("checks ImageBackground props.src existence too", async () => {
    const yamlText = validStoryboardYaml.replace(
      'component: Paragraph\n      props:\n        text: "因为上下文会丢失。"',
      'component: ImageBackground\n      props:\n        src: "assets/images/missing-bg.jpg"',
    );
    const result = await validateProject(yamlText, "storyboard.yaml", {
      projectRoot: fixtureProject(),
      registry,
      probeAudio: okProbe,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.message.includes("missing-bg.jpg")),
      ).toBe(true);
    }
  });

  const doodleSceneYaml = (target: string): string => `schema_version: "0.1"
project:
  id: t
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080
scenes:
  - id: scene-01
    duration: 5
    visual:
      component: DoodleScene
      renderer: canvas
      props:
        strokes:
          - id: d1
            shape: circle
            x: 400
            y: 300
            size: 150
    animations:
      - id: draw-1
        target: ${target}
        type: draw
        start: 0
        duration: 1
`;

  it("rejects an animations[].target that names no canvas element id", async () => {
    const result = await validateProject(
      doodleSceneYaml("stroke-1"),
      "storyboard.yaml",
      { projectRoot: fixtureProject(), registry, probeAudio: okProbe },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (e) =>
            e.field.endsWith("animations.0.target") &&
            e.message.includes("stroke-1") &&
            e.message.includes("d1"),
        ),
      ).toBe(true);
    }
  });

  it("accepts an animations[].target that names a real canvas element id", async () => {
    const result = await validateProject(
      doodleSceneYaml("d1"),
      "storyboard.yaml",
      {
        projectRoot: fixtureProject(),
        registry,
        probeAudio: okProbe,
      },
    );
    expect(result.ok).toBe(true);
  });
});

describe("validateProject — scene clips must be renderable AND audited", () => {
  function clipProject(sidecar: Record<string, unknown> | null): string {
    const root = fixtureProject();
    const videoDir = path.join(root, "assets", "video");
    mkdirSync(videoDir, { recursive: true });
    writeFileSync(path.join(videoDir, "scene_1.mp4"), "mp4");
    if (sidecar !== null) {
      writeFileSync(
        path.join(videoDir, "scene_1.source.json"),
        JSON.stringify(sidecar),
      );
    }
    return root;
  }

  const goodSidecar = {
    schema: "scene-video-source/1",
    source: "commons-video",
    title: "Carrier landing 1944",
    license: "PD",
    pageUrl: "https://commons.wikimedia.org/wiki/File:x.ogv",
  };

  const goodProbe = async () => ({
    width: 1080,
    height: 1920,
    durationSec: 8,
    hasAudio: false,
  });

  it("a silent 1080x1920 clip with a free sidecar validates clean", async () => {
    const root = clipProject(goodSidecar);
    const result = await validateProject(
      validStoryboardYaml,
      "storyboard.yaml",
      {
        projectRoot: root,
        registry,
        probeVideo: goodProbe,
      },
    );
    expect(result.ok).toBe(true);
  });

  it("a clip without a sidecar is an error — provenance is mandatory", async () => {
    const root = clipProject(null);
    const result = await validateProject(
      validStoryboardYaml,
      "storyboard.yaml",
      {
        projectRoot: root,
        registry,
        probeVideo: goodProbe,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.message).join("\n")).toMatch(
        /no attribution sidecar/,
      );
    }
  });

  it("a non-free licence in the sidecar is an error", async () => {
    const root = clipProject({ ...goodSidecar, license: "CC-BY-4.0" });
    const result = await validateProject(
      validStoryboardYaml,
      "storyboard.yaml",
      {
        projectRoot: root,
        registry,
        probeVideo: goodProbe,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.message).join("\n")).toMatch(
        /only PD \/ CC0 \/ PDM/,
      );
    }
  });

  it("geometry, audio, and coverage violations are each reported", async () => {
    const root = clipProject(goodSidecar);
    const result = await validateProject(
      validStoryboardYaml,
      "storyboard.yaml",
      {
        projectRoot: root,
        registry,
        probeVideo: async () => ({
          width: 640,
          height: 480,
          durationSec: 2,
          hasAudio: true,
        }),
      },
    );
    if (!result.ok) {
      const text = result.errors.map((e) => e.message).join("\n");
      expect(text).toMatch(/must be 1080x1920/);
      expect(text).toMatch(/audio track/);
      expect(text).toMatch(/cannot cover the scene/);
    }
  });

  it("a clip for a scene not in the storyboard is stale", async () => {
    const root = clipProject(goodSidecar);
    // fixture storyboard's scenes are scene-01/scene-02 — a clip numbered
    // 9 has no owner.
    writeFileSync(path.join(root, "assets/video/scene_9.mp4"), "mp4");
    const result = await validateProject(
      validStoryboardYaml,
      "storyboard.yaml",
      {
        projectRoot: root,
        registry,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.message).join("\n")).toMatch(
        /no matching scene/,
      );
    }
  });

  it("without probeVideo only file-existence and attribution run", async () => {
    const root = clipProject(goodSidecar);
    const result = await validateProject(
      validStoryboardYaml,
      "storyboard.yaml",
      {
        projectRoot: root,
        registry,
      },
    );
    expect(result.ok).toBe(true);
  });
});
