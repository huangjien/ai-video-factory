import { describe, expect, it } from "vitest";
import {
  fillPrompt,
  loadImageStylePresets,
  loadBgmCatalogue,
  renderBgmCatalogue,
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
  // v0.10.2: the output is six LABELLED lines the .prompt.txt sidecar and the
  // image model both consume, not a paragraph. Matching runs on whitespace-
  // normalized text so a line wrap inside the prompt file can neither fake a
  // pass nor fail the assertion.
  const flat = loadPrompt("draft-image-prompt").replace(/\s+/g, " ");

  it("declares the six labelled lines in a fixed order", () => {
    const labels = [
      "1. Subject:",
      "2. Scene:",
      "3. Composition:",
      "4. Lighting:",
      "5. Style:",
      "6. Constraints:",
    ];
    const positions = labels.map((l) => flat.indexOf(l));
    expect(positions.every((p) => p !== -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("requires a shot, a light source, and a reserved overlay zone", () => {
    // Vagueness is what the model falls back on when the brief is thin:
    // "dramatic lighting" instead of a direction, no framing, no room
    // left for the captions that land on top of the image.
    expect(flat).toContain("wide establishing shot");
    expect(flat).toContain("upper right");
    expect(flat).toContain("lower third");
    expect(flat).toMatch(/Never "dramatic lighting"/);
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
  it("image-styles.yaml has the twelve styles with non-empty blocks", () => {
    const presets = loadImageStylePresets();
    expect(Object.keys(presets).sort()).toEqual([
      "clay-3d",
      "editorial",
      "flat-vector",
      "genki-anime",
      "ink-wash",
      "isometric",
      "manga",
      "medieval",
      "paper-cut",
      "photoreal",
      "watercolor",
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

  it("music.json indexes the curated BGM library with real measurements", () => {
    const cat = loadBgmCatalogue();
    const keys = Object.keys(cat);
    expect(keys.length).toBeGreaterThan(0);
    for (const tag of keys) {
      const e = cat[tag]!;
      expect(e.file).toBe(`${tag}.mp3`);
      expect(e.track.length).toBeGreaterThan(0);
      expect(e.use_when.length).toBeGreaterThan(10);
      expect(e.avoid_when.length).toBeGreaterThan(5);
      expect(e.duration_sec).toBeGreaterThan(0);
      // Loudness is a real ebur128 reading, not a placeholder.
      expect(e.loudness_lufs_i).toBeLessThan(0);
      expect(e.loudness_lufs_i).toBeGreaterThan(-40);
    }
  });

  it("the rendered catalogue carries the numbers the planner needs", () => {
    const out = renderBgmCatalogue();
    expect(out).toContain("LUFS");
    expect(out).toContain("use when:");
    expect(out).toContain("avoid when:");
  });
});
