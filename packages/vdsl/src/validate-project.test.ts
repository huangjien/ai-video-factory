import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
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
  SvgScene: { propsSchema: z.object({}).passthrough() },
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

  it("rejects captions that wrap to more than 3 lines (safe area)", async () => {
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
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field.includes("captions"))).toBe(
        true,
      );
    }
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

  it("rejects renderer: excalidraw (asset-generation only)", async () => {
    const yamlText = validStoryboardYaml.replace(
      "component: Paragraph",
      "component: Paragraph\n      renderer: excalidraw",
    );
    const result = await validateProject(yamlText, "storyboard.yaml", {
      projectRoot: fixtureProject(),
      registry,
      probeAudio: okProbe,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (e) =>
            e.field.endsWith("visual.renderer") &&
            e.message.includes("excalidraw"),
        ),
      ).toBe(true);
    }
  });

  const svgSceneYaml = (target: string): string => `schema_version: "0.1"
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
      component: SvgScene
      renderer: svg
      props:
        nodes:
          - id: n1
            kind: rect
            x: 100
            y: 200
            w: 300
            h: 120
            text: "节点"
    animations:
      - id: draw-1
        target: ${target}
        type: draw
        start: 0
        duration: 1
`;

  it("rejects an animations[].target that names no svg element id", async () => {
    const result = await validateProject(
      svgSceneYaml("node-1"),
      "storyboard.yaml",
      { projectRoot: fixtureProject(), registry, probeAudio: okProbe },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (e) =>
            e.field.endsWith("animations.0.target") &&
            e.message.includes("node-1") &&
            e.message.includes("n1"),
        ),
      ).toBe(true);
    }
  });

  it("accepts an animations[].target that names a real svg element id", async () => {
    const result = await validateProject(svgSceneYaml("n1"), "storyboard.yaml", {
      projectRoot: fixtureProject(),
      registry,
      probeAudio: okProbe,
    });
    expect(result.ok).toBe(true);
  });
});
