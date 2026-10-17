import { describe, expect, it } from "vitest";
import {
  fillPrompt,
  loadImageStylePresets,
  loadMusicPrompts,
  loadPrompt,
  promptFilePath,
} from "./index.js";

describe("loadPrompt", () => {
  it("loads a registered prompt file", () => {
    const prompt = loadPrompt("storyboard");
    expect(prompt).toContain("Storyboard Agent");
    expect(prompt.endsWith("\n")).toBe(false);
  });

  it("caches per process (same string reference)", () => {
    expect(loadPrompt("storyboard")).toBe(loadPrompt("storyboard"));
  });

  it("throws naming the absolute path for a missing prompt", () => {
    expect(() => loadPrompt("definitely-not-a-prompt")).toThrow(
      /prompt file not found: .*definitely-not-a-prompt\.md/,
    );
  });

  it("promptFilePath points inside the registry directory", () => {
    expect(promptFilePath("storyboard")).toMatch(
      /packages[/\\]prompts[/\\]prompts[/\\]storyboard\.md$/,
    );
  });
});

describe("fillPrompt", () => {
  it("replaces {{tokens}}", () => {
    expect(
      fillPrompt("scene's {{duration_sec}}s budget", {
        duration_sec: "4",
      }),
    ).toBe("scene's 4s budget");
  });

  it("throws on a placeholder with no value", () => {
    expect(() => fillPrompt("{{missing}}", {})).toThrow(
      /no value for placeholder \{\{missing\}\}/,
    );
  });

  it("leaves brace-free templates untouched", () => {
    expect(fillPrompt("plain {json} body", {})).toBe("plain {json} body");
  });
});

describe("image brief expander", () => {
  it("declares the six-part brief structure in a fixed order", () => {
    const prompt = loadPrompt("draft-image-prompt");
    const order = ["SUBJECT", "SCENE", "COMPOSITION", "LIGHTING", "STYLE", "CONSTRAINTS"];
    const positions = order.map((part, i) => prompt.indexOf(`${i + 1}. ${part} `));
    expect(positions.every((p) => p !== -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("requires a shot, a light source, and a reserved overlay zone", () => {
    const prompt = loadPrompt("draft-image-prompt");
    // Vagueness is what the model falls back on when the brief is thin:
    // "dramatic lighting" instead of a direction, no framing, no room
    // left for the captions that land on top of the image.
    expect(prompt).toContain("wide establishing shot");
    expect(prompt).toContain("upper right");
    expect(prompt).toContain("lower third");
    expect(prompt).toMatch(/Never "dramatic lighting"/);
  });

  it("bans reasoning, preamble and fences in the output", () => {
    const prompt = loadPrompt("draft-image-prompt");
    expect(prompt).toContain("reasoning");
    expect(prompt).toMatch(/no preamble/i);
    expect(prompt).toContain("no markdown");
  });

  it("asks for English output", () => {
    expect(loadPrompt("draft-image-prompt")).toContain("ENGLISH");
  });
});

describe("structured prompt files", () => {
  it("image-styles.yaml has the three styles with non-empty blocks", () => {
    const presets = loadImageStylePresets();
    expect(Object.keys(presets).sort()).toEqual([
      "editorial",
      "flat-vector",
      "whiteboard",
    ]);
    for (const preset of Object.values(presets)) {
      expect(preset.systemBlock.length).toBeGreaterThan(0);
      expect(preset.promptSuffix).toMatch(/no text|no letters|no labels/);
    }
  });

  it("every style locks a palette and reserves the overlay zone", () => {
    // Cross-scene consistency comes from a shared palette and a shared
    // quiet band for captions — a style that drops either cannot hold a
    // video together, so this is a contract, not a preference.
    for (const [name, preset] of Object.entries(loadImageStylePresets())) {
      expect(preset.systemBlock, name).toMatch(/palette/i);
      expect(preset.systemBlock, name).toMatch(/lower third/);
      expect(preset.promptSuffix, name).toMatch(/quiet lower third/);
    }
  });

  it("music.json maps tags to Chinese prompts", () => {
    const music = loadMusicPrompts();
    expect(music["calm"]).toContain("平静舒缓");
    expect(music["liubang-xiaodiao"]).toContain("琵琶");
  });
});
