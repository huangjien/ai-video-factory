import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_IMAGE_STYLE,
  IMAGE_STYLES,
  resolveImageStyle,
  stylePromptSuffix,
  styleSystemBlock,
} from "./image-style.js";
import { expandScenePrompt } from "./image-prompt.js";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";

class FakeExpander implements Provider {
  readonly name = "fake-expander";
  lastRequest: ChatRequest | null = null;
  calls = 0;
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    this.lastRequest = req;
    return {
      content: "A lone lighthouse on a cliff at dusk, cool light.",
      usage: { input: 10, output: 12 },
    };
  }
}

const scene = {
  id: "scene-02",
  visual: "a network of connected nodes",
  caption: "网络节点",
  narration: "数据在节点之间流动",
};

describe("resolveImageStyle", () => {
  it("defaults missing / invalid values to flat-vector", () => {
    expect(resolveImageStyle(undefined)).toBe("flat-vector");
    expect(resolveImageStyle("")).toBe("flat-vector");
    // "watercolor" was the invalid example here until it became a real
    // preset (51ad647) and this assertion started failing at HEAD; a value
    // that is NOT in IMAGE_STYLES is what this test needs.
    expect(resolveImageStyle("definitely-not-a-style")).toBe("flat-vector");
    expect(resolveImageStyle(null)).toBe(DEFAULT_IMAGE_STYLE);
  });

  it("passes valid styles through", () => {
    for (const s of IMAGE_STYLES) {
      expect(resolveImageStyle(s)).toBe(s);
    }
  });
});

describe("style presets", () => {
  it("every style has a distinct non-empty system block and suffix", () => {
    const blocks = IMAGE_STYLES.map((s) => styleSystemBlock(s));
    const suffixes = IMAGE_STYLES.map((s) => stylePromptSuffix(s));
    for (const b of blocks) expect(b.length).toBeGreaterThan(50);
    for (const s of suffixes) expect(s.length).toBeGreaterThan(30);
    expect(new Set(blocks).size).toBe(IMAGE_STYLES.length);
    expect(new Set(suffixes).size).toBe(IMAGE_STYLES.length);
  });

  it("suffixes explicitly forbid written text (fallback path has no LLM rules)", () => {
    for (const s of IMAGE_STYLES) {
      expect(stylePromptSuffix(s).toLowerCase()).toMatch(/no text/);
    }
  });
});

describe("expandScenePrompt style injection", () => {
  it("injects the style system block and appends the suffix", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "img-style-"));
    const provider = new FakeExpander();
    const out = await expandScenePrompt(
      scene,
      provider,
      dir,
      2,
      { style: "editorial" },
    );
    const system = provider.lastRequest!.messages[0]!.content;
    expect(system).toContain("EDITORIAL ILLUSTRATION");
    // The no-text rule lives in image-no-text-rules.md, injected by
    // styleSystemBlock on every path. Assert the rule that must reach the
    // expander, not the copy of it that used to be duplicated in the
    // expander's own prompt file.
    expect(system).toContain(
      "HARD RULE — the image carries NO READABLE writing",
    );
    expect(system).toContain("RESERVE THE OVERLAY ZONE");
    // The line is drawn at readability, not at the presence of marks:
    // illegible page texture passes, a viewer-readable sign does not.
    expect(system).toContain("cannot tell the marks are wrong");
    expect(out.prompt.endsWith(stylePromptSuffix("editorial"))).toBe(true);
    expect(out.prompt).toContain("A lone lighthouse");
    expect(out.cacheHit).toBe(false);
  });

  it("defaults to flat-vector when no style is given", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "img-style-"));
    const provider = new FakeExpander();
    await expandScenePrompt(scene, provider, dir, 2);
    expect(provider.lastRequest!.messages[0]!.content).toContain(
      "FLAT VECTOR ILLUSTRATION",
    );
  });

  it("cache keys are style-specific: switching styles re-expands", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "img-style-"));
    const provider = new FakeExpander();
    const first = await expandScenePrompt(scene, provider, dir, 2, {
      style: "flat-vector",
    });
    const other = await expandScenePrompt(scene, provider, dir, 2, {
      style: "whiteboard",
    });
    expect(other.cacheHit).toBe(false);
    expect(other.prompt.endsWith(stylePromptSuffix("whiteboard"))).toBe(true);
    const again = await expandScenePrompt(scene, provider, dir, 2, {
      style: "flat-vector",
    });
    expect(again.cacheHit).toBe(true);
    expect(again.prompt).toBe(first.prompt);
    expect(provider.calls).toBe(2);
  });
});
