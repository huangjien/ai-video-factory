import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildMotionPrescreenState,
  consultMotionPrescreen,
  describeMotionPlan,
  motionPrescreenQuestion,
  runMotionPrescreenShadow,
  type MotionDecisionRow,
  type MotionPrescreenScene,
} from "./decision.js";
import { planSceneMotion } from "./plan.js";
import type { DecisionProvider, DecisionRequest } from "@video/llm";

const scene: MotionPrescreenScene = {
  sceneId: "scene-03",
  durationSec: 12.4,
  component: "ImageBackground",
  narrationText: "1979年，事件发生。2018年，事件再次发生。",
  propsSummary: '{"elements":["event-1979","event-2018"]}',
};

const baseline = planSceneMotion({
  sceneId: "scene-03",
  durationSec: 12.4,
  index: 2,
  component: "ImageBackground",
});

function fakeProvider(answer: string | null = "refine"): DecisionProvider {
  return {
    name: "fake",
    lastError: null,
    available: () => true,
    decide: async (_req: DecisionRequest) => {
      if (answer === null) return null;
      return {
        value: { kind: "choice", option: answer },
        confidence: 0.71,
        confidenceSource: "native",
        usage: { input: 220, output: 0 },
        latencyMs: 7,
        provider: "fake",
        model: "fake-1",
      };
    },
  };
}

describe("describeMotionPlan", () => {
  it("names every animation", () => {
    const text = describeMotionPlan(baseline);
    expect(text).toContain("draw");
    expect(text).toContain("highlight");
  });

  it("says so when the scene is held still", () => {
    expect(
      describeMotionPlan({
        animations: [],
        transition: { in: "fade", out: "cut" },
      }),
    ).toContain("held still");
  });
});

describe("buildMotionPrescreenState", () => {
  it("carries the scene facts, the content and the plan", () => {
    const state = buildMotionPrescreenState(scene, baseline);
    expect(state).toContain(
      "Scene scene-03 — 12.40s, component ImageBackground",
    );
    expect(state).toContain("Narration: 1979年");
    expect(state).toContain("event-2018");
    expect(state).toContain("The plan without a second pass:");
  });

  it("omits the narration line when the scene has none", () => {
    const state = buildMotionPrescreenState(
      { ...scene, narrationText: undefined },
      baseline,
    );
    expect(state).not.toContain("Narration:");
  });
});

describe("motionPrescreenQuestion", () => {
  it("offers keep and refine", () => {
    expect(motionPrescreenQuestion("scene-03").options).toEqual([
      "keep",
      "refine",
    ]);
  });

  it("ids the question by scene", () => {
    expect(motionPrescreenQuestion("scene-03").id).toBe(
      "motion-prescreen:scene-03",
    );
  });
});

describe("consultMotionPrescreen", () => {
  it("records the answer and the disagreement with the deterministic path", async () => {
    const row = await consultMotionPrescreen({
      project: "demo",
      scene,
      baseline,
      provider: fakeProvider("refine"),
      mode: "shadow",
    });
    expect(row.surface).toBe("motion-prescreen");
    expect(row.answer).toBe("refine");
    // The deterministic path answers `keep` — the baseline plan is what
    // runs when nobody refines it.
    expect(row.baseline).toBe("keep");
    expect(row.agreed).toBe(false);
    expect(row.confidence).toBeCloseTo(0.71, 5);
  });

  it("records agreement when the decision says keep", async () => {
    const row = await consultMotionPrescreen({
      project: "demo",
      scene,
      baseline,
      provider: fakeProvider("keep"),
      mode: "shadow",
    });
    expect(row.agreed).toBe(true);
  });

  it("records no answer when the provider fails", async () => {
    const row = await consultMotionPrescreen({
      project: "demo",
      scene,
      baseline,
      provider: fakeProvider(null),
      mode: "shadow",
    });
    expect(row.answer).toBeNull();
    expect(row.agreed).toBeNull();
    expect(row.error).toBeTruthy();
  });

  it("never writes the raw state into the row", async () => {
    const row = await consultMotionPrescreen({
      project: "demo",
      scene,
      baseline,
      provider: fakeProvider(),
      mode: "shadow",
    });
    expect(JSON.stringify(row)).not.toContain("1979年");
  });
});

describe("runMotionPrescreenShadow", () => {
  it("does nothing in off mode", async () => {
    const out = await runMotionPrescreenShadow({
      project: "demo",
      scenes: [{ scene, baseline }],
      mode: "off",
      provider: fakeProvider(),
    });
    expect(out.consulted).toBe(0);
  });

  it("appends one row per scene", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "motion-shadow-"));
    const logPath = path.join(dir, "decision-log.jsonl");
    const out = await runMotionPrescreenShadow({
      project: "demo",
      scenes: [
        { scene, baseline },
        { scene: { ...scene, sceneId: "scene-04" }, baseline },
      ],
      mode: "shadow",
      provider: fakeProvider(),
      logPath,
    });
    expect(out.consulted).toBe(2);
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as MotionDecisionRow);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.surface).toBe("motion-prescreen");
    expect(rows[0]?.mode).toBe("shadow");
  });

  it("caps the consults — every consult is a real API call", async () => {
    const out = await runMotionPrescreenShadow({
      project: "demo",
      scenes: [
        { scene, baseline },
        { scene: { ...scene, sceneId: "scene-04" }, baseline },
      ],
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
      const out = await runMotionPrescreenShadow({
        project: "demo",
        scenes: [{ scene, baseline }],
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
});
