import { describe, expect, it } from "vitest";
import { frontmatterHasKey, stampFrontmatterKey } from "./draft-command.js";

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

describe("frontmatterHasKey", () => {
  it("true when the key is declared in the frontmatter block", () => {
    expect(
      frontmatterHasKey(
        "---\nproject: t\ntts_provider: voicebox\n---\nbody",
        "tts_provider",
      ),
    ).toBe(true);
  });

  it("false when the key is absent (only in the body)", () => {
    expect(
      frontmatterHasKey("---\nproject: t\n---\ntts_provider: body-text", "tts_provider"),
    ).toBe(false);
  });

  it("false without frontmatter or without a closing fence", () => {
    expect(frontmatterHasKey("# body", "tts_provider")).toBe(false);
    expect(frontmatterHasKey("---\ntts_provider: x", "tts_provider")).toBe(
      false,
    );
  });
});
