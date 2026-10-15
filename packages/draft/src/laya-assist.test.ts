import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  askLayaVisual,
  buildVisualAssistState,
  resolveVisualOverrides,
} from "./laya-assist.js";
import {
  DEFAULT_VISUAL_COMPONENT,
  LAYA_VISUAL_COMPONENTS,
} from "./visual-classifier.js";
import { readLayaDecisions } from "@video/llm";
import type { LayaClient, LayaDecision } from "@video/llm";
import type { ParsedArticle } from "./schemas.js";

/** Client stub whose decide() is replaced per-test. */
function fakeClient(
  impl: (state: string) => Promise<LayaDecision | null>,
): LayaClient {
  return { decide: impl } as unknown as LayaClient;
}

const decision = (
  value: string,
  confidence = 0.9,
  routingModel = "english",
): LayaDecision => ({
  answers: {
    component: { type: "choice", value, confidence, routingModel },
  },
  latencyMs: 5,
  routingModel,
});

/** No keyword in either RULES cluster matches these → both fall through. */
const article = (): ParsedArticle =>
  ({
    frontmatter: {
      project: "t",
      language: "zh-CN",
      duration_target_sec: 60,
      voice: "v",
    },
    proseBody: "",
    markdown: "",
    scenes: [
      {
        id: "scene-01",
        duration: 8,
        caption: "cap 0",
        visual: "开篇画面", // index 0 — never consulted (Title)
        narration: "开场",
      },
      {
        id: "scene-02",
        duration: 8,
        caption: "cap 1",
        visual: "一段完全没有任何关键词的内容",
        narration: "普通叙述文本",
      },
      {
        id: "scene-03",
        duration: 8,
        caption: "cap 2",
        visual: "growth chart of revenue", // matches BarChart rule
        narration: "数字",
      },
    ],
  }) as ParsedArticle;

describe("buildVisualAssistState", () => {
  it("includes index, visual and narration", () => {
    const s = buildVisualAssistState("compare A vs B", "旁白", 3);
    expect(s).toContain("scene index: 3");
    expect(s).toContain("compare A vs B");
    expect(s).toContain("旁白");
  });
});

describe("askLayaVisual", () => {
  it("returns the component when laya answers with a valid one", async () => {
    const client = fakeClient(() => Promise.resolve(decision("BarChart")));
    const res = await askLayaVisual(client, "chart of growth", "n", 2);
    expect(res?.component).toBe("BarChart");
    expect(res?.routingModel).toBe("english");
  });

  it("returns null when laya answers null / unknown component", async () => {
    const nullClient = fakeClient(() => Promise.resolve(null));
    expect(await askLayaVisual(nullClient, "x", "", 1)).toBeNull();
    const badClient = fakeClient(() =>
      Promise.resolve(decision("NotAComponent")),
    );
    expect(await askLayaVisual(badClient, "x", "", 1)).toBeNull();
    const titleClient = fakeClient(() => Promise.resolve(decision("Title")));
    expect(await askLayaVisual(titleClient, "x", "", 1)).toBeNull();
  });

  it("never throws when the client throws", async () => {
    const boom = fakeClient(() => Promise.reject(new Error("down")));
    expect(await askLayaVisual(boom, "x", "", 1)).toBeNull();
  });
});

describe("resolveVisualOverrides", () => {
  it("consults ONLY fall-through scenes (skips first + rule matches)", async () => {
    const asked: string[] = [];
    const client = fakeClient((state) => {
      asked.push(state);
      return Promise.resolve(decision("BarChart"));
    });
    const res = await resolveVisualOverrides(article(), client, {
      mode: "on",
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("一段完全没有任何关键词的内容");
    expect(res.overrides.get(1)).toBe("BarChart");
    expect(res.overrides.has(2)).toBe(false); // rule matched — untouched
    expect(res.asked).toBe(1);
    expect(res.answered).toBe(1);
  });

  it("shadow mode: same consults, empty overrides, sidecar rows with expected", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "laya-visual-"));
    const sidecar = path.join(dir, "laya-decisions.jsonl");
    const client = fakeClient(() => Promise.resolve(decision("BarChart")));
    const res = await resolveVisualOverrides(article(), client, {
      mode: "shadow",
      sidecarPath: sidecar,
    });
    expect(res.overrides.size).toBe(0);
    const rows = await readLayaDecisions(sidecar);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.surface).toBe("visual");
    expect(rows[0]!.mode).toBe("shadow");
    expect(rows[0]!.expected).toBe(DEFAULT_VISUAL_COMPONENT);
    expect(rows[0]!.agreed).toBe(false);
    expect(rows[0]!.acted).toBe(false);
  });

  it("laya unavailable → no overrides, sidecar row with null answers", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "laya-visual-"));
    const sidecar = path.join(dir, "laya-decisions.jsonl");
    const client = fakeClient(() => Promise.resolve(null));
    const res = await resolveVisualOverrides(article(), client, {
      mode: "on",
      sidecarPath: sidecar,
    });
    expect(res.overrides.size).toBe(0);
    expect(res.answered).toBe(0);
    const rows = await readLayaDecisions(sidecar);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.answers).toBeNull();
    expect(rows[0]!.agreed).toBeUndefined();
  });

  it("never throws when the client rejects", async () => {
    const client = fakeClient(() => Promise.reject(new Error("boom")));
    const res = await resolveVisualOverrides(article(), client, {
      mode: "on",
    });
    expect(res.overrides.size).toBe(0);
  });
});

describe("LAYA_VISUAL_COMPONENTS", () => {
  it("excludes Title and DoodleScene", () => {
    expect(LAYA_VISUAL_COMPONENTS).not.toContain("Title");
    expect(LAYA_VISUAL_COMPONENTS).not.toContain("DoodleScene");
    expect(LAYA_VISUAL_COMPONENTS).toContain("BarChart");
  });
});
