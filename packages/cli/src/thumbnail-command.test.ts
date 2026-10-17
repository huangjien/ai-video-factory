import { describe, expect, it } from "vitest";
import { applyVisualIdentity } from "./thumbnail-command.js";

// v0.10.3: `video thumbnail` folds the video's visual identity into the
// prompt in code, so the contract rides along even when
// youtube/thumbnail-prompt.txt was written by an older agent or hand-edited —
// the same guarantee `expandScenePrompt` gives the scene briefs.
describe("applyVisualIdentity", () => {
  const PROMPT =
    "Young commander · grim resolve · palace gate at dawn · medium shot · warm low sun · amber and ink palette";

  it("appends the verbatim style contract for the article's preset", () => {
    const out = applyVisualIdentity(PROMPT, { image_style: "editorial" });
    expect(out.startsWith(PROMPT)).toBe(true);
    expect(out).toContain("editorial illustration");
    // The suffix is the same contract the scene briefs carry.
    expect(out).toMatch(/no text, no letters/);
  });

  it("appends the setting line and keeps the prompt first", () => {
    const out = applyVisualIdentity(PROMPT, {
      setting: "Tang-dynasty China, 626-630 CE",
    });
    expect(out.startsWith(PROMPT)).toBe(true);
    expect(out).toContain(
      "Setting (the whole video is set here — era, region and culture; the image must stay inside it): Tang-dynasty China, 626-630 CE",
    );
  });

  it("carries both when both are declared", () => {
    const out = applyVisualIdentity(PROMPT, {
      image_style: "editorial",
      setting: "Tang-dynasty China",
    });
    expect(out).toContain("editorial illustration");
    expect(out).toContain("Tang-dynasty China");
    // Style contract before the setting line, matching the scene-brief order.
    expect(out.indexOf("editorial illustration")).toBeLessThan(
      out.indexOf("Setting ("),
    );
  });

  it("a typo'd preset coerces to the default instead of throwing", () => {
    // article.md is human-edited; a bad style name must not kill the
    // thumbnail. resolveImageStyle falls back the way `video make` does.
    expect(() =>
      applyVisualIdentity(PROMPT, { image_style: "cinema-35mm-nope" }),
    ).not.toThrow();
  });

  it("whitespace-only setting is treated as absent", () => {
    const out = applyVisualIdentity(PROMPT, { setting: "   " });
    expect(out).toBe(PROMPT);
  });

  it("no article at all is a no-op (legacy projects)", () => {
    expect(applyVisualIdentity(PROMPT, null)).toBe(PROMPT);
  });

  it("an article with neither key is a no-op", () => {
    expect(applyVisualIdentity(PROMPT, {})).toBe(PROMPT);
  });
});
