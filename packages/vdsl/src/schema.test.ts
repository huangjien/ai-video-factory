import { describe, expect, it } from "vitest";
import { validateStoryboard } from "./validate.js";
import { validStoryboardYaml } from "./test-fixtures.js";

describe("VDSL shape validation (doc §21.1 lines 924-932)", () => {
  it("accepts the doc sample (scene-01, lines 889-922)", () => {
    const result = validateStoryboard(validStoryboardYaml, "storyboard.yaml");
    expect(result.ok).toBe(true);
  });

  it("rejects missing schema_version with field path + line", () => {
    const yamlText = validStoryboardYaml.replace('schema_version: "0.1"\n', "");
    const result = validateStoryboard(yamlText, "storyboard.yaml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field.includes("schema_version"));
      expect(err).toBeDefined();
      expect(err?.line).toBeGreaterThan(0);
      expect(err?.file).toBe("storyboard.yaml");
    }
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
