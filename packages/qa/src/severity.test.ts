import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LayaAnswer, LayaClient } from "@video/llm";
import { readLayaDecisions } from "@video/llm";
import {
  SEVERITY_PROMOTE_THRESHOLD,
  buildSeverityState,
  gradeFindings,
  gradeSeverity,
  isGradedFinding,
  levelForScore,
  severityFactsFrom,
  severityScaleFor,
  type SeverityFacts,
} from "./severity.js";
import type { QaFixableFinding } from "./checks.js";

/** A client that answers every score question with the same score. */
function scoringClient(score: number): LayaClient {
  return {
    decide: async () => ({
      answers: {
        severity: {
          type: "score",
          value: String(score),
          score,
          confidence: 0.9,
          routingModel: "english",
        } satisfies LayaAnswer,
      },
      latencyMs: 5,
      routingModel: "english",
    }),
  } as unknown as LayaClient;
}

function finding(over: Partial<QaFixableFinding> = {}): QaFixableFinding {
  return {
    level: "warn",
    check: "sceneAudioSync",
    message: "scene scene-01: narration is 2.40s but the scene is 2.00s",
    fix: "Re-run `video make`.",
    ...over,
  };
}

function sidecar(): string {
  return path.join(
    mkdtempSync(path.join(tmpdir(), "qa-severity-")),
    "laya-decisions.jsonl",
  );
}

describe("isGradedFinding", () => {
  it("grades the checks whose severity varies with magnitude", () => {
    expect(isGradedFinding({ check: "sceneAudioSync" })).toBe(true);
    expect(isGradedFinding({ check: "captionFit" })).toBe(true);
    expect(isGradedFinding({ check: "sceneBoundaries" })).toBe(true);
  });

  it("does NOT grade a structurally-wrong check", () => {
    // A missing file is broken, not a matter of degree.
    expect(isGradedFinding({ check: "assets" })).toBe(false);
    expect(isGradedFinding({ check: "captions" })).toBe(false);
  });
});

describe("severityFactsFrom", () => {
  it("extracts the drift in seconds from a sceneAudioSync message", () => {
    const f = severityFactsFrom(finding());
    expect(f.magnitude).toBeCloseTo(0.4, 5);
    expect(f.unit).toBe("seconds of drift");
    expect(f.currentLevel).toBe("warn");
  });

  it("extracts the line count from a captionFit message", () => {
    const f = severityFactsFrom(
      finding({
        check: "captionFit",
        message:
          "scene scene-01: a caption cue wraps to 4 lines (safe area fits 3 × 24 units)",
      }),
    );
    expect(f.magnitude).toBe(4);
    expect(f.unit).toBe("caption lines");
  });

  it("extracts the detected-cut percentage from a sceneBoundaries message", () => {
    const f = severityFactsFrom(
      finding({
        check: "sceneBoundaries",
        message: "only 12/45 expected scene cuts detected",
      }),
    );
    expect(f.magnitude).toBe(27); // 12/45 rounded
    expect(f.unit).toBe("percent of expected cuts detected");
  });

  it("falls back to a relative severity when no magnitude is derivable", () => {
    const f = severityFactsFrom(
      finding({
        check: "stale-render",
        message: "scene 1's mp4 predates its regenerated scene image",
      }),
    );
    expect(f.magnitude).toBe(0);
    expect(f.unit).toBe("relative severity");
  });
});

describe("the level/score mapping", () => {
  it("maps warn to the low band and error to the high band", () => {
    expect(severityScaleFor("warn")).toBeLessThan(severityScaleFor("error"));
    expect(levelForScore(severityScaleFor("error"))).toBe("error");
    expect(levelForScore(severityScaleFor("warn"))).toBe("warn");
  });
});

describe("buildSeverityState", () => {
  it("carries the check, the magnitude and today's level", () => {
    const facts: SeverityFacts = severityFactsFrom(finding());
    const state = buildSeverityState(facts);
    expect(state).toContain("check: sceneAudioSync");
    expect(state).toContain("seconds of drift");
    expect(state).toContain("today's level: warn");
  });
});

describe("gradeSeverity", () => {
  it("leaves a STRUCTURALLY-wrong finding alone, and does not even ask", async () => {
    let asked = 0;
    const client = {
      decide: async () => {
        asked += 1;
        return null;
      },
    } as unknown as LayaClient;
    const res = await gradeSeverity(
      finding({ check: "assets", level: "error" }),
      severityFactsFrom(finding({ check: "assets", level: "error" })),
      { mode: "on", client },
    );
    expect(asked).toBe(0);
    expect(res.finding.level).toBe("error");
    expect(res.promoted).toBe(false);
  });

  it("SHADOW NEVER CHANGES THE LEVEL", async () => {
    const f = finding();
    const res = await gradeSeverity(f, severityFactsFrom(f), {
      mode: "shadow",
      client: scoringClient(95),
    });
    expect(res.finding.level).toBe("warn");
    expect(res.promoted).toBe(false);
    // …but the score IS recorded, for §7.
    expect(res.score).toBe(95);
  });

  it("ON mode RAISES a warn to an error when the score is high", async () => {
    const f = finding();
    const res = await gradeSeverity(f, severityFactsFrom(f), {
      mode: "on",
      client: scoringClient(SEVERITY_PROMOTE_THRESHOLD),
    });
    expect(res.finding.level).toBe("error");
    expect(res.promoted).toBe(true);
  });

  it("NEVER LOWERS an error to a warn", async () => {
    // The decision may say "this matters more", never "this is fine".
    const f = finding({ level: "error" });
    const res = await gradeSeverity(f, severityFactsFrom(f), {
      mode: "on",
      client: scoringClient(5),
    });
    expect(res.finding.level).toBe("error");
    expect(res.promoted).toBe(false);
  });

  it("keeps a warn at warn when the score is low", async () => {
    const f = finding();
    const res = await gradeSeverity(f, severityFactsFrom(f), {
      mode: "on",
      client: scoringClient(20),
    });
    expect(res.finding.level).toBe("warn");
    expect(res.promoted).toBe(false);
  });

  it("does nothing in off mode", async () => {
    const f = finding();
    const res = await gradeSeverity(f, severityFactsFrom(f), {
      mode: "off",
      client: scoringClient(99),
    });
    expect(res.finding.level).toBe("warn");
    expect(res.score).toBeNull();
  });

  it("records the shadow row with today's level as the baseline", async () => {
    const file = sidecar();
    const f = finding();
    await gradeSeverity(f, severityFactsFrom(f), {
      mode: "shadow",
      client: scoringClient(95),
      sidecarPath: file,
    });
    const rows = await readLayaDecisions(file);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.surface).toBe("severity");
    expect(rows[0]!.questions["severity"]?.type).toBe("score");
    expect(rows[0]!.expected).toBe(String(severityScaleFor("warn")));
    // The score (95) is far above the warn baseline, so it disagrees.
    expect(rows[0]!.agreed).toBe(false);
    expect(rows[0]!.acted).toBe(false);
  });

  it("a score INSIDE today's band agrees; a score in the other band does not", async () => {
    // The baseline is a LEVEL mapped onto the score scale, so the
    // comparison is numeric with a tolerance — a score of 60 is a warn
    // (59 +/- 15), a score of 95 is an error.
    const inBand = sidecar();
    await gradeSeverity(finding(), severityFactsFrom(finding()), {
      mode: "shadow",
      client: scoringClient(60),
      sidecarPath: inBand,
    });
    expect((await readLayaDecisions(inBand))[0]!.agreed).toBe(true);

    const outOfBand = sidecar();
    await gradeSeverity(finding(), severityFactsFrom(finding()), {
      mode: "shadow",
      client: scoringClient(95),
      sidecarPath: outOfBand,
    });
    expect((await readLayaDecisions(outOfBand))[0]!.agreed).toBe(false);
  });
});

describe("gradeFindings", () => {
  it("grades each finding on its own", async () => {
    const findings = [
      finding({
        message: "scene scene-01: narration is 2.40s but the scene is 2.00s",
      }),
      finding({
        check: "captionFit",
        message:
          "scene scene-02: a caption cue wraps to 4 lines (safe area fits 3 × 24 units)",
      }),
    ];
    const out = await gradeFindings(findings, {
      mode: "on",
      client: scoringClient(95),
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.level).toBe("error");
    expect(out[1]!.level).toBe("error");
  });

  it("passes structurally-wrong findings through untouched", async () => {
    const findings = [
      finding({ check: "assets", level: "error" }),
      finding({ check: "captions", level: "warn" }),
    ];
    const out = await gradeFindings(findings, {
      mode: "on",
      client: scoringClient(95),
    });
    expect(out[0]!.level).toBe("error");
    expect(out[1]!.level).toBe("warn");
  });

  it("returns the findings unchanged in off mode", async () => {
    const findings = [finding()];
    const out = await gradeFindings(findings, {
      mode: "off",
      client: scoringClient(95),
    });
    expect(out[0]!.level).toBe("warn");
  });

  it("NEVER THROWS when the client throws", async () => {
    const client = {
      decide: async () => {
        throw new Error("boom");
      },
    } as unknown as LayaClient;
    const out = await gradeFindings([finding()], { mode: "on", client });
    expect(out[0]!.level).toBe("warn");
  });
});
