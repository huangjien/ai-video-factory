import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fillPrompt,
  loadImageStylePresets,
  loadBgmCatalogue,
  loadAndValidateBgmCatalogue,
  renderBgmCatalogue,
  BGM_DEFAULT_TAG,
  BGM_TRACK_EXTENSIONS,
  resolveBgmDirectory,
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

describe("BGM library integrity", () => {
  it("BGM_DEFAULT_TAG names a real track in the catalogue", () => {
    const cat = loadBgmCatalogue();
    expect(cat[BGM_DEFAULT_TAG]).toBeDefined();
    expect(cat[BGM_DEFAULT_TAG]!.file).toBe(`${BGM_DEFAULT_TAG}.mp3`);
  });

  it("resolveBgmDirectory defaults to <repoRoot>/assets/bgm/", () => {
    expect(resolveBgmDirectory("/x/y")).toBe(path.join("/x/y", "assets", "bgm"));
  });

  it("every catalogue tag has a backing file in assets/bgm/ on disk", () => {
    const { catalogue, drift } = loadAndValidateBgmCatalogue();
    // The CI check the planner relies on: if you commit a music.json
    // entry without the corresponding mp3, the audio-plan agent will
    // pick a tag that fails at mix time.
    if (drift.catalogueOrphans.length > 0) {
      throw new Error(
        `these catalogue entries have no file in ${resolveBgmDirectory()}: ` +
          drift.catalogueOrphans.join(", "),
      );
    }
    expect(catalogue[BGM_DEFAULT_TAG]).toBeDefined();
  });

  it("isolated drift detection: catalogue vs filesystem on both sides", () => {
    // Sandbox: catalogue registers 'foo' only, but the library has
    // 'bar'. Both directions of drift surface in one report:
    // foo is a catalogueOrphan (no file), bar is a filesystemOrphan
    // (no catalogue entry).
    const sandbox = mkdtempSync(path.join(tmpdir(), "bgm-drift-"));
    const libDir = resolveBgmDirectory(sandbox);
    mkdirSync(libDir, { recursive: true });
    const catalogueDir = path.join(sandbox, "prompts", "prompts");
    mkdirSync(catalogueDir, { recursive: true });
    writeFileSync(
      path.join(catalogueDir, "music.json"),
      JSON.stringify({
        foo: {
          track: "Foo",
          artist: "Tester",
          file: "foo.mp3",
          duration_sec: 60,
          loudness_lufs_i: -12,
          dynamic_range_lu: 4,
          use_when: "test",
          avoid_when: "tests",
          needs_loop_under_300s: false,
          quiet_master: false,
          wide_dynamics: false,
        },
      }),
    );
    writeFileSync(path.join(libDir, "bar.mp3"), Buffer.from([0xff]));
    try {
      const { drift } = loadAndValidateBgmCatalogue(sandbox, catalogueDir);
      expect(drift.catalogueOrphans).toEqual(["foo"]);
      expect(drift.filesystemOrphans).toEqual(["bar"]);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("BGM_TRACK_EXTENSIONS stays in sync with the file-based provider's list", () => {
    // The list is duplicated between @video/audio-assets and
    // @video/prompts. If you change one, change both — a mismatch
    // produces silent "tag not found" failures at mix time.
    expect([...BGM_TRACK_EXTENSIONS]).toEqual([".wav", ".mp3", ".m4a"]);
  });
});
