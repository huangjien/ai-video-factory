import { describe, expect, it } from "vitest";
import { validateStoryboard } from "./validate.js";
import { validStoryboardYaml } from "./test-fixtures.js";

describe("VDSL shape validation (doc §21.1 lines 924-932)", () => {
  it("accepts the doc sample (scene-01, lines 889-922)", () => {
    const result = validateStoryboard(validStoryboardYaml, "storyboard.yaml");
    expect(result.ok).toBe(true);
  });

  it("defaults a missing schema_version to 0.2 (0.1 storyboards still validate)", () => {
    const yamlText = validStoryboardYaml.replace('schema_version: "0.1"\n', "");
    const result = validateStoryboard(yamlText, "storyboard.yaml");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.schema_version).toBe("0.2");
    }
    expect(validateStoryboard(validStoryboardYaml, "storyboard.yaml").ok).toBe(
      true,
    );
  });

  it("rejects duplicate scene ids, pointing at the SECOND occurrence line", () => {
    const yamlText = validStoryboardYaml.replace(
      "  - id: scene-02",
      "  - id: scene-01",
    );
    const result = validateStoryboard(yamlText, "storyboard.yaml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes("scene-01"))).toBe(
        true,
      );
    }
  });

  it("rejects duration <= 0 with the duration field's YAML line", () => {
    const yamlText = validStoryboardYaml.replace("duration: 8", "duration: 0");
    const result = validateStoryboard(yamlText, "storyboard.yaml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field.includes("duration"));
      expect(err).toBeDefined();
      expect(err?.line).toBeGreaterThan(0);
    }
  });

  it("rejects unknown fields (strict) with the unknown key's line", () => {
    const yamlText = validStoryboardYaml.replace(
      'schema_version: "0.1"',
      'schema_version: "0.1"\nfoo: bar',
    );
    const result = validateStoryboard(yamlText, "storyboard.yaml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field.includes("foo"));
      expect(err).toBeDefined();
      expect(err?.line).toBe(2);
    }
  });

  it("rejects scenes: [] (min 1)", () => {
    const yamlText = validStoryboardYaml.replace(
      /scenes:[\s\S]*$/,
      "scenes: []",
    );
    const result = validateStoryboard(yamlText, "storyboard.yaml");
    expect(result.ok).toBe(false);
  });

  it("rejects unregistered animation entrance enum values", () => {
    const yamlText = validStoryboardYaml.replace(
      "entrance: fade",
      "entrance: teleport",
    );
    const result = validateStoryboard(yamlText, "storyboard.yaml");
    expect(result.ok).toBe(false);
  });

  it("returns line-numbered errors instead of crashing on malformed YAML (tab indent)", () => {
    const yamlText = "project:\n\tid: x\n";
    const result = validateStoryboard(yamlText, "storyboard.yaml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.line).toBeGreaterThan(0);
      expect(result.errors[0]?.message).toMatch(/tab|indent|map/i);
    }
  });
});

describe("renderer defaults (defaults.renderer inheritance)", () => {
  const withDefaults = (renderer: string) => `schema_version: "0.2"
defaults:
  renderer: ${renderer}
project: {id: t, language: zh-CN, fps: 30, width: 1920, height: 1080}
scenes:
  - id: a
    duration: 8
    visual: {component: DoodleScene, props: {}}
  - id: b
    duration: 4
    visual: {component: Title, props: {text: b}, renderer: remotion}
`;

  it("applies defaults.renderer to scenes that omit visual.renderer", () => {
    const result = validateStoryboard(withDefaults("canvas"), "storyboard.yaml");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.scenes[0]?.visual.renderer).toBe("canvas");
    }
  });

  it("per-scene renderer overrides the project default", () => {
    const result = validateStoryboard(withDefaults("canvas"), "storyboard.yaml");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.scenes[1]?.visual.renderer).toBe("remotion");
    }
  });

  it("falls back to remotion with no defaults and no per-scene renderer", () => {
    const result = validateStoryboard(validStoryboardYaml, "storyboard.yaml");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.data.scenes.every((s) => s.visual.renderer === "remotion"),
      ).toBe(true);
    }
  });

  it("coerces synonyms in defaults.renderer (hand-drawn → canvas)", () => {
    const result = validateStoryboard(withDefaults("hand-drawn"), "storyboard.yaml");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.scenes[0]?.visual.renderer).toBe("canvas");
    }
  });

  it("rejects an unknown defaults.renderer value", () => {
    const result = validateStoryboard(withDefaults("webgl"), "storyboard.yaml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.message).toMatch(/webgl/);
      expect(result.errors[0]?.field).toContain("defaults");
    }
  });

  it("rejects unknown keys inside defaults (strict)", () => {
    const yamlText = withDefaults("canvas").replace(
      "defaults:\n",
      "defaults:\n  bogus: 1\n",
    );
    const result = validateStoryboard(yamlText, "storyboard.yaml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field.includes("defaults"))).toBe(true);
    }
  });
});

describe("map insert — one per film under a channel profile (CS-14)", () => {
  const mapScene = (id: string) => `  - id: ${id}
    duration: 6
    visual:
      component: MapInsert
      props: {}
`;

  const plainScene = (id: string) => `  - id: ${id}
    duration: 4
    visual:
      component: ImageBackground
      props: {}
`;

  /** `maps` map-insert scenes plus one ordinary image scene. */
  const board = (profile: string | null, maps: number): string => {
    const scenes = Array.from({ length: maps }, (_, i) =>
      mapScene(`scene-0${i + 1}`),
    ).join("");
    return `schema_version: "0.2"

project:
  id: t
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080

style:
  theme: paper-light${profile === null ? "" : `\n  channel_profile: ${profile}`}

scenes:
${scenes}${plainScene(`scene-9${maps}`)}
`;
  };

  it("accepts exactly one map insert under chinese-storybook", () => {
    expect(validateStoryboard(board("chinese-storybook", 1), "storyboard.yaml").ok).toBe(
      true,
    );
  });

  it("accepts a film with no map insert at all", () => {
    expect(validateStoryboard(board("chinese-storybook", 0), "storyboard.yaml").ok).toBe(
      true,
    );
  });

  it("rejects a second map insert under the profile", () => {
    const result = validateStoryboard(board("chinese-storybook", 2), "storyboard.yaml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.message).join(" ")).toMatch(
        /one map insert per film/,
      );
    }
  });

  it("leaves boards with no channel profile unchanged", () => {
    // The rule belongs to the profile, not the schema — a project that
    // never opted in must keep validating two maps.
    expect(validateStoryboard(board(null, 2), "storyboard.yaml").ok).toBe(true);
  });
});
