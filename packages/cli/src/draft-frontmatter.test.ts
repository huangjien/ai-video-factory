import { describe, expect, it } from "vitest";
import { stampFrontmatterKey } from "./draft-command.js";

describe("stampFrontmatterKey", () => {
  it("inserts into an existing frontmatter block", () => {
    const md = "---\nproject: t\nlanguage: zh-CN\n---\n\n# body";
    const out = stampFrontmatterKey(md, "image_style", "editorial");
    expect(out).toBe(
      "---\nproject: t\nlanguage: zh-CN\nimage_style: editorial\n---\n\n# body",
    );
  });

  it("replaces an existing key in place", () => {
    const md = "---\nimage_style: whiteboard\nproject: t\n---\nbody";
    expect(stampFrontmatterKey(md, "image_style", "flat-vector")).toBe(
      "---\nimage_style: flat-vector\nproject: t\n---\nbody",
    );
  });

  it("no-op without frontmatter", () => {
    expect(stampFrontmatterKey("# just body", "image_style", "editorial")).toBe(
      "# just body",
    );
  });
});
