import { describe, expect, it } from "vitest";
import { extractYaml } from "./agent.js";


describe("extractYaml — a reasoning model's sketch is not the answer", () => {
  it("skips a YAML sketch inside <think> and takes the real answer", () => {
    // minimax reasons out loud, and its thinking contains a YAML sketch
    // with `...` placeholders. Taking the first fence parsed the sketch,
    // which is not a package.
    const raw = [
      "<think>",
      "```yaml",
      'title: "a sketch"',
      "description: |",
      "  ...",
      "```",
      "</think>",
      "```yaml",
      'title: "the real answer"',
      'description: "d"',
      "chapters:",
      '  - timestamp: "00:00"',
      '    title: "c"',
      'thumbnail_prompt: "p"',
      'shorts_hook: "s"',
      "```",
    ].join("\n");
    expect(extractYaml(raw)).toContain("the real answer");
    expect(extractYaml(raw)).not.toContain("a sketch");
  });

  it("still handles a plain fenced answer", () => {
    expect(extractYaml('```yaml\ntitle: "x"\n```')).toContain("title: \"x\"");
  });
});
