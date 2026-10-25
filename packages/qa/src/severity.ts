import { loadPrompt } from "@video/prompts";
import { LayaClient, recordDecision, type LayaMode } from "@video/llm";
import type { QaFixableFinding } from "./checks.js";

/**
 * Severity grading for QA findings — the first `score` decision surface.
 *
 * A finding carries a LEVEL (`error` | `warn`), and that level is what
 * gates the export: `video qa --strict` exits 1 on any error-level
 * finding. But the level is chosen by hand from a CONTINUOUS fact — a
 * 0.4 s audio mismatch, a caption cue that wraps one line too far, a
 * cut-detection ratio of 40%. "Error" vs "warn" is a judgement, and
 * today it is a judgement made once, by whoever wrote the check, with
 * no way to see whether it was the right call.
 *
 * This module lets a `score` decision grade a finding's severity, so
 * the judgement is:
 *
 *  - REPRODUCIBLE — the same finding is graded the same way every run,
 *    because the decision is a function of the finding's facts;
 *  - COMPARABLE — the score is a number on one scale, so a 0.4 s
 *    mismatch and a 4 s mismatch can be ranked against each other;
 *  - AUDITABLE — shadow mode records today's hand-picked level as the
 *    baseline, so §7 can measure how often the decision agrees with
 *    the human call before anything is allowed to act on it.
 *
 * WHAT STAYS DETERMINISTIC: a finding that is STRUCTURALLY wrong — a
 * caption cue beyond the safe area, non-monotonic cue times, a missing
 * file — is an error, full stop. No decision layer gets to downgrade
 * it. Only findings whose severity is genuinely a matter of degree are
 * offered to the scorer; see `isGradedFinding`.
 *
 * Like every Laya surface, this one is ADVISORY. In shadow it records
 * and changes nothing. In `on` mode it may raise a finding's level,
 * never lower it: a decision may say "this matters more than you
 * thought", but it may not say "this is fine" about a defect the
 * deterministic check found. Lowering a level is a decision the human
 * makes.
 */

/** Body lives in `packages/prompts/prompts/qa-severity.md` — edit it there. */
export const QA_SEVERITY_INSTRUCTIONS = loadPrompt("qa-severity");

/** Question id used in the sidecar row. */
export const LAYA_SEVERITY_QID = "severity";

/** The score at or above which a graded finding is treated as an error.
 *
 *  This is the policy dial, and it mirrors the article judge's bar: the
 *  decision produces a number, the threshold turns it into a level.
 *  Below it, the finding stays at `warn`. */
export const SEVERITY_ERROR_THRESHOLD = 60;

/** The score at or above which a graded finding is treated as an error
 *  even when today's hand-picked level was `warn`. A graded finding
 *  whose score reaches this is promoted; one that does not keeps its
 *  current level. */
export const SEVERITY_PROMOTE_THRESHOLD = 75;

/** How far a score may sit from today's mapped level and still count
 *  as agreement for the §7 gate.
 *
 *  The two bands are 15 points apart (warn maps to 59, error to 75), so
 *  a tolerance of 15 lets a score land anywhere in the band it agrees
 *  with, while a score in the other band does not. */
export const SEVERITY_AGREEMENT_TOLERANCE = 15;

/**
 * A finding whose severity is a matter of DEGREE, so a score can grade
 * it — as opposed to one that is structurally wrong.
 *
 * The distinction is the whole point of this surface. A caption cue
 * that wraps to 4 lines when the safe area fits 3 is objectively
 * broken: no score can make it acceptable. A narration that runs 0.4 s
 * past its scene is a matter of degree — the pipeline tolerates some
 * drift, and where the line sits depends on how visible the result is.
 *
 * The checks listed here are the ones whose severity genuinely varies
 * with the magnitude of the fact. A check not listed here keeps its
 * hand-picked level, whatever the decision says.
 */
const GRADED_CHECKS: ReadonlySet<string> = new Set([
  "sceneAudioSync",
  "captionFit",
  "sceneBoundaries",
  "stale-render",
]);

/** Is this finding one a score is allowed to grade? */
export function isGradedFinding(
  finding: Pick<QaFixableFinding, "check">,
): boolean {
  return GRADED_CHECKS.has(finding.check);
}

/** The facts a severity decision is made from.
 *
 *  Deliberately small: the check name, the measured deviation, and
 *  whether the viewer would see it. A decision made from a wall of
 *  prose is a decision nobody can audit later.
 */
export interface SeverityFacts {
  /** The check that produced the finding. */
  check: string;
  /** The finding's message — the measured fact in words. */
  message: string;
  /** The magnitude of the deviation, in the check's own unit. The
   *  meaning depends on the check (seconds of drift, lines over the
   *  safe area, ratio of unmatched cuts). */
  magnitude: number;
  /** The unit of `magnitude`, so the grader is not left guessing. */
  unit: string;
  /** Today's hand-picked level — the shadow baseline. */
  currentLevel: "error" | "warn";
}

/** Build the state string a severity decision reads. */
export function buildSeverityState(facts: SeverityFacts): string {
  return [
    `check: ${facts.check}`,
    `measured deviation: ${facts.magnitude} ${facts.unit}`,
    `finding: ${facts.message}`,
    `today's level: ${facts.currentLevel}`,
  ].join("\n");
}

/** What a severity decision produced. */
export interface SeverityOutcome {
  /** The finding with its level possibly raised. Never lowered. */
  finding: QaFixableFinding;
  /** The score the decision returned, or null when there was none. */
  score: number | null;
  /** True when the decision RAISED the level from warn to error. */
  promoted: boolean;
}

export interface GradeSeveritiesOptions {
  mode: LayaMode;
  /** Where to write the shadow rows. */
  sidecarPath?: string | undefined;
  /** The client to consult. Null when the mode is off. */
  client?: LayaClient | null | undefined;
}

/**
 * Grade one finding's severity.
 *
 * Returns the finding with its level possibly RAISED — never lowered —
 * plus the score for auditing. In shadow mode the finding is unchanged
 * and the decision is only recorded.
 */
export async function gradeSeverity(
  finding: QaFixableFinding,
  facts: SeverityFacts,
  opts: GradeSeveritiesOptions,
): Promise<SeverityOutcome> {
  // A structurally-wrong finding keeps its level, whatever a decision
  // says. The decision is not even asked.
  if (!isGradedFinding(finding)) {
    return { finding, score: null, promoted: false };
  }
  if (
    opts.mode === "off" ||
    opts.client === undefined ||
    opts.client === null
  ) {
    return { finding, score: null, promoted: false };
  }

  const res = await recordDecision(opts.client, {
    surface: "severity",
    state: buildSeverityState(facts),
    question: {
      id: LAYA_SEVERITY_QID,
      type: "score",
      instructions: QA_SEVERITY_INSTRUCTIONS,
    },
    mode: opts.mode,
    // The baseline is today's hand-picked level. The §7 agreement rate
    // therefore measures "does the score agree with the human call" —
    // and a score surface needs a NUMERIC comparison, which is why the
    // score is mapped onto the level's scale below.
    baseline: severityScaleFor(facts.currentLevel),
    // The baseline is a LEVEL mapped onto the score scale, so the
    // comparison is numeric with a tolerance: a score near the band
    // agrees with today's call, a score far from it does not. Without a
    // tolerance the score would have to land on exactly 59 or exactly
    // 75, and the §7 gate could never be passed.
    tolerance: SEVERITY_AGREEMENT_TOLERANCE,
    ...(opts.sidecarPath !== undefined
      ? { sidecarPath: opts.sidecarPath }
      : {}),
  });

  if (res.score === null) {
    return { finding, score: null, promoted: false };
  }

  // The decision may RAISE a level. It may never lower one: a
  // defect the deterministic check found does not become acceptable
  // because a score said so. Lowering is the human's call.
  //
  // And it may only raise in `on` mode. In shadow the decision is
  // RECORDED and nothing else — the report must be byte-identical to
  // what the deterministic path produced, or the §7 calibration is
  // measuring a moving target.
  const promoted =
    opts.mode === "on" &&
    facts.currentLevel === "warn" &&
    res.score >= SEVERITY_PROMOTE_THRESHOLD;
  if (!promoted) {
    return { finding, score: res.score, promoted: false };
  }
  return {
    finding: { ...finding, level: "error" },
    score: res.score,
    promoted: true,
  };
}

/** Map today's level onto the score scale, so a score and a level are
 *  comparable. `warn` is the low band, `error` the high band.
 *
 *  The bands are the SAME thresholds the promotion uses, so the mapping
 *  and the policy cannot drift apart. */
export function severityScaleFor(level: "error" | "warn"): number {
  return level === "error"
    ? SEVERITY_PROMOTE_THRESHOLD
    : SEVERITY_ERROR_THRESHOLD - 1;
}

/** The level a score maps to on the same scale. */
export function levelForScore(score: number): "error" | "warn" {
  return score >= SEVERITY_PROMOTE_THRESHOLD ? "error" : "warn";
}

/**
 * Derive the measurable facts a severity decision reads, from the
 * finding's own message.
 *
 * The facts are extracted from the MESSAGE rather than carried
 * alongside it, because the message is the one thing every check
 * already produces — and a fact that only exists in a parallel
 * structure is a fact that can drift from the message that describes
 * it.
 *
 * When a magnitude cannot be derived, it is reported as 0 with the
 * unit "relative severity" — the decision still has the check name and
 * the message, which is what it mostly reads.
 */
export function severityFactsFrom(finding: QaFixableFinding): SeverityFacts {
  const check = finding.check;
  const message = finding.message;

  // sceneAudioSync: "narration is 2.40s but the scene is 2.00s"
  if (check === "sceneAudioSync") {
    const m = message.match(/is ([\d.]+)s but the scene is ([\d.]+)s/);
    if (m) {
      const drift = Math.abs(Number(m[1]) - Number(m[2]));
      return {
        check,
        message,
        magnitude: Math.round(drift * 1000) / 1000,
        unit: "seconds of drift",
        currentLevel: finding.level,
      };
    }
  }

  // captionFit: "a caption cue wraps to 4 lines (safe area fits 3 × 24 units)"
  if (check === "captionFit") {
    const m = message.match(/wraps to (\d+) lines/);
    if (m) {
      return {
        check,
        message,
        magnitude: Number(m[1]),
        unit: "caption lines",
        currentLevel: finding.level,
      };
    }
  }

  // sceneBoundaries: "only 12/45 expected scene cuts detected"
  if (check === "sceneBoundaries") {
    const m = message.match(/only (\d+)\/(\d+) expected scene cuts/);
    if (m) {
      const total = Number(m[2]);
      const matched = Number(m[1]);
      return {
        check,
        message,
        magnitude: total > 0 ? Math.round((matched / total) * 100) : 0,
        unit: "percent of expected cuts detected",
        currentLevel: finding.level,
      };
    }
  }

  // stale-render: no magnitude — the fact is binary (the mp4 predates
  // its image), so the message carries it.
  return {
    check,
    message,
    magnitude: 0,
    unit: "relative severity",
    currentLevel: finding.level,
  };
}

/**
 * Grade a batch of findings.
 *
 * Each finding is graded on its own, so a batch of ten findings means
 * ten decisions — one per finding, not one per report. The findings
 * that are not graded (structurally wrong, or from a check that has no
 * graded severity) pass through untouched.
 */
export async function gradeFindings(
  findings: readonly QaFixableFinding[],
  opts: GradeSeveritiesOptions,
): Promise<QaFixableFinding[]> {
  if (
    opts.mode === "off" ||
    opts.client === undefined ||
    opts.client === null
  ) {
    return [...findings];
  }
  const out: QaFixableFinding[] = [];
  for (const finding of findings) {
    const res = await gradeSeverity(finding, severityFactsFrom(finding), opts);
    out.push(res.finding);
  }
  return out;
}
