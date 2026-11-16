import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildCaptionOverlapState,
  captionOverlapQuestion,
  captionOverlapScenes,
  consultCaptionOverlap,
  runCaptionOverlapShadow,
  type CaptionDecisionRow,
  type CaptionOverlapScene,
} from "./caption-decision.js";
import type { DecisionProvider, DecisionRequest } from "@video/llm";
import type { RenderPlan } from "@video/vdsl";

const scene: CaptionOverlapScene = {
  sceneId: "scene-09",
  sceneIndex: 9,
  sceneCount: 25,
  component: "Comparison",
  cues: [
    { startSec: 3.2, endSec: 5.1, text: "同一个普通人" },
    { startSec: 5.1, endSec: 7.4, text: "不一样的需求" },
  ],
};

function fakeProvider(probability: number | null = 0.05): DecisionProvider {
  return {
    name: "fake",
    lastError: null,
    available: () => true,
    decide: async (_req: DecisionRequest) => {
      if (probability === null) return null;
      return {
        value: { kind: "noul", probability },
        confidence: probability,
        confidenceSource: "native",
        usage: { input: 180, output: 0 },
        latencyMs: 6,
        provider: "fake",
        model: "fake-1",
      };
    },
  };
}

describe("buildCaptionOverlapState", () => {
  it("names the frame, the caption and the absence of other text", () => {
    const state = buildCaptionOverlapState(scene);
    expect(state).toContain("Frame 9 of 25");
    expect(state).toContain("2 cue(s) from 00:03 to 00:07");
    expect(state).toContain("同一个普通人");
    expect(state).toContain("No other text is drawn in that region.");
  });

  it("says where the scene's own text sits", () => {
    const state = buildCaptionOverlapState({
      ...scene,
      ownText: "同一个普通人",
      ownPlacement: "in-band",
    });
    expect(state).toContain(
      "The scene also draws its own text in the caption band",
    );
  });

  it("says when the scene's own text sits above the band", () => {
    const state = buildCaptionOverlapState({
      ...scene,
      ownText: "标题",
      ownPlacement: "above-band",
    });
    expect(state).toContain(
      "The scene also draws its own text above the caption band",
    );
  });

  it("handles a frame with no caption cue", () => {
    const state = buildCaptionOverlapState({ ...scene, cues: [] });
    expect(state).toContain("This frame has no caption cue.");
  });
});

describe("captionOverlapQuestion", () => {
  it("is a noul question about the bottom band", () => {
    const q = captionOverlapQuestion("scene-09");
    expect(q.kind).toBe("noul");
    expect(q.instructions).toContain("bottom band");
    expect(q.trueMeaning).toBeTruthy();
    expect(q.falseMeaning).toBeTruthy();
  });
});

describe("consultCaptionOverlap", () => {
  it("records the probability and the agreement with the deterministic path", async () => {
    const row = await consultCaptionOverlap({
      project: "demo",
      scene,
      provider: fakeProvider(0.05),
      mode: "shadow",
    });
    expect(row.surface).toBe("caption-overlap");
    expect(row.answer).toBe("0.05");
    expect(row.baseline).toBe("false");
    expect(row.agreed).toBe(true);
  });

  it("records a disagreement when the model calls an overlap", async () => {
    const row = await consultCaptionOverlap({
      project: "demo",
      scene,
      provider: fakeProvider(0.9),
      mode: "shadow",
    });
    expect(row.agreed).toBe(false);
  });

  it("records no answer when the provider fails", async () => {
    const row = await consultCaptionOverlap({
      project: "demo",
      scene,
      provider: fakeProvider(null),
      mode: "shadow",
    });
    expect(row.answer).toBeNull();
    expect(row.agreed).toBeNull();
    expect(row.error).toBeTruthy();
  });

  it("never writes the raw state into the row", async () => {
    const row = await consultCaptionOverlap({
      project: "demo",
      scene,
      provider: fakeProvider(0.05),
      mode: "shadow",
    });
    expect(JSON.stringify(row)).not.toContain("同一个普通人");
  });
});

describe("captionOverlapScenes", () => {
  const plan = {
    scenes: [
      {
        id: "scene-01",
        component: "Title",
        props: {},
        captions: { cues: [{ lines: ["一句话"], startSec: 0, endSec: 2 }] },
        overlay: { title: "标题", position: "top" },
      },
      {
        id: "scene-02",
        component: "Comparison",
        props: {},
        captions: { cues: [{ lines: ["另一句"], startSec: 2, endSec: 4 }] },
        overlay: { title: "卡片标题", position: "bottom" },
      },
      {
        id: "scene-03",
        component: "ImageBackground",
        props: {},
        captions: null,
      },
    ],
  } as unknown as RenderPlan;

  it("consults only the captioned scenes", () => {
    const scenes = captionOverlapScenes(plan);
    expect(scenes.map((s) => s.sceneId)).toEqual(["scene-01", "scene-02"]);
  });

  it("numbers the frames", () => {
    const scenes = captionOverlapScenes(plan);
    expect(scenes[0]?.sceneIndex).toBe(1);
    expect(scenes[0]?.sceneCount).toBe(3);
  });

  it("reads the overlay's position — a bottom overlay IS the caption band", () => {
    const scenes = captionOverlapScenes(plan);
    expect(scenes[0]?.ownPlacement).toBe("above-band");
    expect(scenes[1]?.ownPlacement).toBe("in-band");
  });

  it("joins the cue lines into the cue text", () => {
    const scenes = captionOverlapScenes(plan);
    expect(scenes[0]?.cues[0]?.text).toBe("一句话");
  });
});

describe("runCaptionOverlapShadow", () => {
  it("does nothing in off mode", async () => {
    const out = await runCaptionOverlapShadow({
      project: "demo",
      scenes: [scene],
      mode: "off",
      provider: fakeProvider(),
    });
    expect(out.consulted).toBe(0);
  });

  it("appends one row per frame", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "caption-shadow-"));
    const logPath = path.join(dir, "decision-log.jsonl");
    const out = await runCaptionOverlapShadow({
      project: "demo",
      scenes: [scene, { ...scene, sceneId: "scene-10", sceneIndex: 10 }],
      mode: "shadow",
      provider: fakeProvider(),
      logPath,
    });
    expect(out.consulted).toBe(2);
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as CaptionDecisionRow);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.surface).toBe("caption-overlap");
  });

  it("caps the consults", async () => {
    const out = await runCaptionOverlapShadow({
      project: "demo",
      scenes: [scene, { ...scene, sceneId: "scene-10", sceneIndex: 10 }],
      mode: "shadow",
      provider: fakeProvider(),
      maxConsults: 1,
    });
    expect(out.consulted).toBe(1);
  });

  it("skips cleanly when no provider has a key", async () => {
    const key = process.env["OPENAI_API_KEY"];
    const minimaxKey = process.env["MINIMAX_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["MINIMAX_API_KEY"];
    const seen: string[] = [];
    const original = console.error;
    console.error = (message: string) => seen.push(message);
    try {
      const out = await runCaptionOverlapShadow({
        project: "demo",
        scenes: [scene],
        mode: "shadow",
      });
      expect(out.consulted).toBe(0);
      expect(seen.some((m) => m.includes("key not set"))).toBe(true);
    } finally {
      console.error = original;
      if (key !== undefined) process.env["OPENAI_API_KEY"] = key;
      if (minimaxKey !== undefined) {
        process.env["MINIMAX_API_KEY"] = minimaxKey;
      }
    }
  });

  it("honours DECISION_PROVIDER and DECISION_MODEL from the environment", async () => {
    const key = process.env["OPENAI_API_KEY"];
    const minimaxKey = process.env["MINIMAX_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["MINIMAX_API_KEY"];
    const original = console.error;
    console.error = () => {};
    try {
      const out = await runCaptionOverlapShadow({
        project: "demo",
        scenes: [scene],
        mode: "shadow",
        env: {
          DECISION_PROVIDER: "openai",
          DECISION_MODEL: "gpt-6-luna",
        } as NodeJS.ProcessEnv,
      });
      expect(out.consulted).toBe(0);
    } finally {
      console.error = original;
      if (key !== undefined) process.env["OPENAI_API_KEY"] = key;
      if (minimaxKey !== undefined) {
        process.env["MINIMAX_API_KEY"] = minimaxKey;
      }
    }
  });
});
