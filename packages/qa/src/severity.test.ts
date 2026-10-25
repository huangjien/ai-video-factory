import { describe, expect, it } from "vitest";
import {
  buildSeverityState,
  isGradedFinding,
  levelForScore,
  severityFactsFrom,
  severityScaleFor,
  type SeverityFacts,
} from "./severity.js";
import type { QaFixableFinding } from "./checks.js";

function finding(over: Partial<QaFixableFinding> = {}): QaFixableFinding {
  return {
    level: "warn",
    check: "sceneAudioSync",
    message: "scene scene-01: narration is 2.40s but the scene is 2.00s",
    fix: "Re-run `video make`.",
    ...over,
  };
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
