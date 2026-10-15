import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LayaClient, LayaDecision } from "@video/llm";
import { readLayaDecisions } from "@video/llm";
import {
  buildTriageState,
  contactSheetFilter,
  deterministicTriageVerdict,
  triageReportWithLaya,
  type QaFinding,
  type RenderReport,
} from "./index.js";

const finding = (level: "error" | "warn", check = "x"): QaFinding => ({
  level,
  check,
  message: `${check} broken`,
});

const report = (findings: QaFinding[]): RenderReport =>
  ({
    video: "/tmp/v.mp4",
    generatedAt: "2026-10-14T00:00:00Z",
    ok: !findings.some((f) => f.level === "error"),
    findings,
    checks: {
      duration: { expectedSec: 60, actualSec: 60.1, ok: true },
      fps: { expected: 30, actual: 30, ok: true },
      resolution: { expected: "1920x1080", actual: "1920x1080", ok: true },
      audio: { hasAudio: true, expectedAudio: true, ok: true },
      blackFrames: [],
      assets: { missing: [], ok: true },
      sceneAudioSync: { rows: [], ok: true },
      captions: { ok: true } as RenderReport["checks"]["captions"],
      sceneBoundaries: { ok: true } as RenderReport["checks"]["sceneBoundaries"],
    },
  }) as RenderReport;

const decision = (
  value: string,
  confidence = 0.9,
): LayaDecision => ({
  answers: {
    triage: { type: "choice", value, confidence, routingModel: "english" },
  },
  latencyMs: 7,
  routingModel: "english",
});

const fakeClient = (
  impl: (state: string) => Promise<LayaDecision | null>,
): LayaClient => ({ decide: impl }) as unknown as LayaClient;

describe("deterministicTriageVerdict", () => {
  it("error → block, warn-only → review, clean → pass", () => {
    expect(deterministicTriageVerdict(report([]))).toBe("pass");
    expect(deterministicTriageVerdict(report([finding("warn")]))).toBe("review");
    expect(
      deterministicTriageVerdict(report([finding("warn"), finding("error")])),
    ).toBe("block");
  });
});

describe("buildTriageState", () => {
  it("summarizes counts and top findings", () => {
    const r = report([finding("error", "assets"), finding("warn", "blackFrames")]);
    const s = buildTriageState(r);
    expect(s).toContain("errors=1 warnings=1");
    expect(s).toContain("assets");
    expect(s).toContain("blackFrames");
    expect(s.length).toBeLessThan(2000);
  });
});

describe("triageReportWithLaya", () => {
  it("maps a valid verdict", async () => {
    const client = fakeClient(() => Promise.resolve(decision("review", 0.75)));
    const t = await triageReportWithLaya(client, report([]));
    expect(t?.verdict).toBe("review");
    expect(t?.confidence).toBe(0.75);
    expect(t?.routingModel).toBe("english");
  });

  it("null on laya-null, invalid verdict, or throw", async () => {
    const n = fakeClient(() => Promise.resolve(null));
    expect(await triageReportWithLaya(n, report([]))).toBeNull();
    const bad = fakeClient(() => Promise.resolve(decision("maybe")));
    expect(await triageReportWithLaya(bad, report([]))).toBeNull();
    const boom = fakeClient(() => Promise.reject(new Error("down")));
    expect(await triageReportWithLaya(boom, report([]))).toBeNull();
  });
});

describe("contactSheetFilter", () => {
  it("base chain without caption", () => {
    expect(contactSheetFilter(0.5, 320, 4, 3)).toBe(
      "fps=0.5,scale=320:-1,tile=4x3",
    );
  });

  it("caption is drawtext-escaped when a system font exists", () => {
    const vf = contactSheetFilter(0.5, 320, 4, 3, "laya: review (conf 0.82)");
    if (!vf.includes("drawtext")) {
      return; // no system font on this machine — caption is skipped
    }
    expect(vf).toContain("laya\\: review");
    expect(vf.startsWith("fps=0.5,scale=320:-1,tile=4x3,drawtext=")).toBe(true);
  });
});
