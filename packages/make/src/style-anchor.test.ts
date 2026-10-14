import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ImageProvider } from "@video/media-generators";
import type { ParsedArticle } from "@video/draft";

/**
 * Regression test for the style-anchor idempotency bug. The first
 * version of generateSceneVisuals only set styleAnchor inside the
 * post-generation try-block, so re-runs with --reference-style-anchor
 * silently dropped the anchor when scene_1.jpg already existed on
 * disk — scenes 2..N lost their conditioning. This test spies on
 * MockImageProvider.prototype.generate so it can assert on the exact
 * args every call receives, and proves the anchor flows through on
 * both fresh and idempotent paths. Doc §T6.2.
 */

interface GenerateCall {
  prompt: string;
  referenceImage?: string;
}

function makeRecordingProvider(): ImageProvider & {
  calls: GenerateCall[];
} {
  const calls: GenerateCall[] = [];
  return {
    name: "recording-mock",
    calls,
    async generate(req) {
      const call: GenerateCall = { prompt: req.prompt };
      if (req.referenceImage) call.referenceImage = req.referenceImage;
      calls.push(call);
      return {
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        contentType: "image/jpeg",
      };
    },
  };
}

const fakeArticle: ParsedArticle = {
  frontmatter: {
    project: "fixture",
    language: "zh-CN",
    duration_target_sec: 12,
    voice: "zh-CN-XunjianNeural",
  },
  proseBody: "",
  markdown: "",
  scenes: [
    { id: "scene_1", visual: "title visual", caption: "cap 1", narration: "n 1", duration: 4 },
    { id: "scene_2", visual: "body visual", caption: "cap 2", narration: "n 2", duration: 4 },
    { id: "scene_3", visual: "ending visual", caption: "cap 3", narration: "n 3", duration: 4 },
  ],
};

let tempDir: string;
let recording: ReturnType<typeof makeRecordingProvider>;
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "anchor-test-"));
  recording = makeRecordingProvider();
  // Swap the prototype's generate() with the recording one. The
  // constructor's `this` is irrelevant; the recording impl ignores it.
  const { MockImageProvider } = await import("@video/media-generators");
  spy = vi
    .spyOn(MockImageProvider.prototype, "generate")
    .mockImplementation(
      (recording as unknown as { generate: ImageProvider["generate"] }).generate,
    );
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  spy.mockRestore();
});

describe("generateSceneVisuals — style-anchor wiring", () => {
  it("promotes the anchor on a fresh run: scenes 2..3 condition on scene 1", async () => {
    const { generateSceneVisuals } = await import("./index.js");
    const outputs = await generateSceneVisuals(tempDir, fakeArticle, {
      provider: "mock",
      referenceStyleAnchor: true,
    });
    expect(recording.calls).toHaveLength(3);
    expect(recording.calls[0]?.referenceImage).toBeUndefined();
    expect(recording.calls[1]?.referenceImage).toBe(
      path.join(tempDir, "assets", "images", "scene_1.jpg"),
    );
    expect(recording.calls[2]?.referenceImage).toBe(
      path.join(tempDir, "assets", "images", "scene_1.jpg"),
    );
    expect(outputs.some((l) => l.includes("style anchor: scene_1"))).toBe(true);
  });

  it("promotes the anchor on an idempotent re-run (regression)", async () => {
    const scene1 = path.join(tempDir, "assets", "images", "scene_1.jpg");
    mkdirSync(path.dirname(scene1), { recursive: true });
    writeFileSync(scene1, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const { generateSceneVisuals } = await import("./index.js");
    const outputs = await generateSceneVisuals(tempDir, fakeArticle, {
      provider: "mock",
      referenceStyleAnchor: true,
    });
    expect(recording.calls).toHaveLength(2);
    expect(recording.calls[0]?.referenceImage).toBe(scene1);
    expect(recording.calls[1]?.referenceImage).toBe(scene1);
    expect(outputs.some((l) => l.includes("referenceStyleAnchor:"))).toBe(false);
  });

  it("respects anchorScene: scene 3 anchors scenes 4+; scenes 1-3 generate unanchored", async () => {
    const longerArticle: ParsedArticle = {
      frontmatter: {
        project: "fixture",
        language: "zh-CN",
        duration_target_sec: 20,
        voice: "zh-CN-XunjianNeural",
      },
      proseBody: "",
      markdown: "",
      scenes: Array.from({ length: 5 }, (_, i) => ({
        id: `scene_${i + 1}`,
        visual: `visual ${i + 1}`,
        caption: `cap ${i + 1}`,
        narration: `n ${i + 1}`,
        duration: 4,
      })),
    };
    const { generateSceneVisuals } = await import("./index.js");
    await generateSceneVisuals(tempDir, longerArticle, {
      provider: "mock",
      referenceStyleAnchor: true,
      anchorScene: 3,
    });
    expect(recording.calls).toHaveLength(5);
    for (let i = 0; i < 3; i++) {
      expect(recording.calls[i]?.referenceImage).toBeUndefined();
    }
    const scene3 = path.join(tempDir, "assets", "images", "scene_3.jpg");
    expect(recording.calls[3]?.referenceImage).toBe(scene3);
    expect(recording.calls[4]?.referenceImage).toBe(scene3);
  });

  it("warns when anchorScene > scene count", async () => {
    const { generateSceneVisuals } = await import("./index.js");
    const outputs = await generateSceneVisuals(tempDir, fakeArticle, {
      provider: "mock",
      referenceStyleAnchor: true,
      anchorScene: 99,
    });
    expect(
      outputs.some(
        (l) =>
          l.includes("anchorScene=99") && l.includes("no scenes will be conditioned"),
      ),
    ).toBe(true);
    for (const c of recording.calls) {
      expect(c.referenceImage).toBeUndefined();
    }
  });
});

