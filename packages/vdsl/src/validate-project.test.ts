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
};

function fixtureProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vf-proj-"));
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
});
