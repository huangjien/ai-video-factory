import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  consultVisualDecisions,
  createDecisionProvider,
  decisionLogPath,
  harvestDecisionCandidates,
  resolveDecisionMode,
  sha256,
  visualDecisionQuestion,
  type VisualDecisionRow,
  type VisualDecisionScene,
} from "./visual-decision.js";
import { parseDecisionLog } from "./decision-log.js";
import type {
  DecisionAnswer,
  DecisionProvider,
  DecisionRequest,
} from "@video/llm";

/** A provider that always answers `FlowChart`. */
function fakeProvider(
  answer: string | null = "FlowChart",
  opts: { throw?: boolean; confidence?: number } = {},
): DecisionProvider {
  return {
    name: "fake",
    lastError: null,
    available: () => true,
    decide: async (req: DecisionRequest): Promise<DecisionAnswer | null> => {
      if (opts.throw) throw new Error("provider exploded");
      if (answer === null) return null;
      return {
        value: { kind: "choice", option: answer },
        confidence: opts.confidence ?? 0.8,
        confidenceSource: "native",
        usage: { input: 10, output: 0 },
        latencyMs: 5,
        provider: "fake",
        model: "fake-1",
      };
    },
  };
}

const scenes: VisualDecisionScene[] = [
  { id: "scene-01", visual: "少年立在崖边望向远方" },
  { id: "scene-02", visual: "流水线 步骤 流程" },
];

describe("resolveDecisionMode", () => {
  it("defaults to off", () => {
    expect(resolveDecisionMode({})).toBe("off");
  });

  it("reads shadow", () => {
    expect(resolveDecisionMode({ DECISION_MODE: "shadow" })).toBe("shadow");
  });

  it("reads on", () => {
    expect(resolveDecisionMode({ DECISION_MODE: "on" })).toBe("on");
  });

  it("rejects an unknown mode", () => {
    expect(() => resolveDecisionMode({ DECISION_MODE: "loud" })).toThrow(
      /unknown DECISION_MODE/,
    );
  });
});

describe("createDecisionProvider", () => {
  it("builds the openai provider by default", () => {
    expect(createDecisionProvider().name).toBe("openai");
  });

  it("builds the minimax provider on request", () => {
    expect(createDecisionProvider({ provider: "minimax" }).name).toBe("minimax");
  });

  it("rejects an unknown provider", () => {
    expect(() => createDecisionProvider({ provider: "nope" })).toThrow(
      /unknown decision provider/,
    );
  });
});

describe("visualDecisionQuestion", () => {
  it("carries the registry's wording", () => {
    const question = visualDecisionQuestion("scene-01");
    expect(question.instructions.length).toBeGreaterThan(20);
  });

  it("offers the routable components", () => {
    const question = visualDecisionQuestion("scene-01");
    expect(question.options).toContain("FlowChart");
    expect(question.options).toContain("AnimatedIllustration");
  });
});

describe("consultVisualDecisions", () => {
  it("asks nothing in off mode", async () => {
    const rows = await consultVisualDecisions({
      scenes,
      provider: fakeProvider(),
      mode: "off",
    });
    expect(rows).toHaveLength(0);
  });

  it("asks only about the scenes the classifier could not route", async () => {
    const rows = await consultVisualDecisions({
      scenes,
      provider: fakeProvider(),
      mode: "shadow",
    });
    expect(rows).toHaveLength(1);
  });

  it("records the classifier's answer as the baseline", async () => {
    const rows = await consultVisualDecisions({
      scenes,
      provider: fakeProvider(),
      mode: "shadow",
    });
    expect(rows[0]?.baseline).toBe("AnimatedIllustration");
  });

  it("records the decision's answer", async () => {
    const rows = await consultVisualDecisions({
      scenes,
      provider: fakeProvider("CycleDiagram"),
      mode: "shadow",
    });
    expect(rows[0]?.answer).toBe("CycleDiagram");
  });

  it("marks a disagreement", async () => {
    const rows = await consultVisualDecisions({
      scenes,
      provider: fakeProvider("CycleDiagram"),
      mode: "shadow",
    });
    expect(rows[0]?.agreed).toBe(false);
  });

  it("marks an agreement", async () => {
    const rows = await consultVisualDecisions({
      scenes,
      provider: fakeProvider("AnimatedIllustration"),
      mode: "shadow",
    });
    expect(rows[0]?.agreed).toBe(true);
  });

  it("never writes the raw state", async () => {
    const rows = await consultVisualDecisions({
      scenes,
      provider: fakeProvider(),
      mode: "shadow",
    });
    expect(rows[0]?.state_sha256).toHaveLength(64);
  });

  it("skips a scene the human routed", async () => {
    const rows = await consultVisualDecisions({
      scenes: [{ id: "scene-01", visual: "少年立在崖边望向远方", component: "Title" }],
      provider: fakeProvider(),
      mode: "shadow",
    });
    expect(rows).toHaveLength(0);
  });

  it("survives a provider that throws", async () => {
    const rows = await consultVisualDecisions({
      scenes,
      provider: fakeProvider(null, { throw: true }),
      mode: "shadow",
    });
    expect(rows[0]?.error).toContain("provider exploded");
  });

  it("records an unanswered case as an error, not a crash", async () => {
    const rows = await consultVisualDecisions({
      scenes,
      provider: fakeProvider(null),
      mode: "shadow",
    });
    expect(rows[0]?.answer).toBeNull();
  });

  it("appends one JSONL row per consult", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "decision-log-"));
    const logPath = decisionLogPath(dir);
    await consultVisualDecisions({
      scenes,
      provider: fakeProvider(),
      mode: "shadow",
      logPath,
    });
    const body = await readFile(logPath, "utf8");
    expect(body.trim().split("\n")).toHaveLength(1);
  });

  it("does not fail when the log cannot be written", async () => {
    const rows = await consultVisualDecisions({
      scenes,
      provider: fakeProvider(),
      mode: "shadow",
      logPath: "/definitely/not/a/writable/path/decision-log.jsonl",
    });
    expect(rows).toHaveLength(1);
  });
});


/** One log row, as the shadow pass writes it. */
function row(over: Partial<VisualDecisionRow> = {}): VisualDecisionRow {
  return {
    ts: "2026-11-14T00:00:00.000Z",
    surface: "visual-class",
    scene_id: "scene-19",
    mode: "shadow",
    provider: "openai",
    model: "gpt-6-luna",
    state_sha256: sha256("两摞账本并排放在浅灰地面上"),
    answer: "Checklist",
    confidence: 0.71,
    confidence_source: "native",
    baseline: "AnimatedIllustration",
    agreed: false,
    latency_ms: 312,
    usage: { input: 466, output: 0 },
    error: null,
    ...over,
  };
}

const harvestScenes: VisualDecisionScene[] = [
  { id: "scene-19", visual: "两摞账本并排放在浅灰地面上" },
];

describe("parseDecisionLog", () => {
  it("reads one row per line", () => {
    const rows = parseDecisionLog(`${JSON.stringify(row())}\n`);
    expect(rows).toHaveLength(1);
  });

  it("skips a truncated last line", () => {
    const rows = parseDecisionLog(`${JSON.stringify(row())}\n{"ts":"x`);
    expect(rows).toHaveLength(1);
  });
});

describe("harvestDecisionCandidates", () => {
  it("turns a disagreement into a candidate", () => {
    const candidates = harvestDecisionCandidates({
      rows: [row()],
      scenes: harvestScenes,
      project: "努力",
    });
    expect(candidates).toHaveLength(1);
  });

  it("recovers the real state from the scene", () => {
    const candidates = harvestDecisionCandidates({
      rows: [row()],
      scenes: harvestScenes,
      project: "努力",
    });
    expect(candidates[0]?.state).toBe("两摞账本并排放在浅灰地面上");
  });

  it("proposes the decision's answer as the label", () => {
    const candidates = harvestDecisionCandidates({
      rows: [row()],
      scenes: harvestScenes,
      project: "努力",
    });
    expect(candidates[0]?.expects.value).toBe("Checklist");
  });

  it("keeps the classifier's answer as the baseline", () => {
    const candidates = harvestDecisionCandidates({
      rows: [row()],
      scenes: harvestScenes,
      project: "努力",
    });
    expect(candidates[0]?.baseline).toBe("AnimatedIllustration");
  });

  it("marks every candidate disputed — a proposal is not a label", () => {
    const candidates = harvestDecisionCandidates({
      rows: [row()],
      scenes: harvestScenes,
      project: "努力",
    });
    expect(candidates[0]?.disputed).toBe(true);
  });

  it("says which model proposed it", () => {
    const candidates = harvestDecisionCandidates({
      rows: [row()],
      scenes: harvestScenes,
      project: "努力",
    });
    expect(candidates[0]?.dispute).toContain("gpt-6-luna");
  });

  it("keeps an agreement — a corpus needs both the easy and the hard cases", () => {
    const candidates = harvestDecisionCandidates({
      rows: [row({ agreed: true })],
      scenes: harvestScenes,
      project: "努力",
    });
    expect(candidates).toHaveLength(1);
  });

  it("says the two agreed", () => {
    const candidates = harvestDecisionCandidates({
      rows: [row({ agreed: true })],
      scenes: harvestScenes,
      project: "努力",
    });
    expect(candidates[0]?.dispute).toContain("the two agreed");
  });

  it("skips a row whose scene is gone", () => {
    const candidates = harvestDecisionCandidates({
      rows: [
        row({
          scene_id: "scene-99",
          state_sha256: sha256("a scene that is not in the article"),
        }),
      ],
      scenes: harvestScenes,
      project: "努力",
    });
    expect(candidates).toHaveLength(0);
  });

  it("falls back to the state hash when the scene id moved", () => {
    const candidates = harvestDecisionCandidates({
      rows: [row({ scene_id: "scene-99" })],
      scenes: harvestScenes,
      project: "努力",
    });
    expect(candidates).toHaveLength(1);
  });

  it("skips a row with no answer", () => {
    const candidates = harvestDecisionCandidates({
      rows: [row({ answer: null })],
      scenes: harvestScenes,
      project: "努力",
    });
    expect(candidates).toHaveLength(0);
  });

  it("names the project and the scene in the provenance", () => {
    const candidates = harvestDecisionCandidates({
      rows: [row()],
      scenes: harvestScenes,
      project: "努力",
    });
    expect(candidates[0]?.provenance.source).toContain("projects/努力/article.md");
  });
});
