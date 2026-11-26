import type { DecisionSurface } from "./decision-questions.js";

/**
 * The labelling rules the decision layer's answers are measured against.
 *
 * These live apart from the corpus machinery (which is gone with the
 * corpus): the runtime consults them, the bench measured them, and the
 * rule table is the part that still describes what a correct answer
 * looks like on every surface.
 */

/** What a decision answer is expected to be. */
export interface DecisionExpectation {
  /** Must match the surface's question kind. */
  kind: "choice" | "score" | "noul";
  /** `choice`: the option. `score`: the level index. `noul`: "true" /
   *  "false" — the side the probability must land on. */
  value: string | number | boolean;
  /** `noul`: the band the probability must fall in. Omitted = any side
   *  of the threshold is acceptable. */
  probability?: [number, number] | undefined;
  /** `score`: how far the score may sit from `value`. */
  tolerance?: number | undefined;
}

/** The labelling rule that produced an answer's label. Every surface has
 *  its own set. */
export type DecisionPolicyRule =
  | "qa-finding-level"
  | "review-verdict"
  | "structure-over-photo"
  | "photo"
  | "thesis"
  | "caption-band"
  | "motion-specificity"
  | "section-verdict";

/** The rules each surface may use. */
export const DECISION_POLICY_RULES: Record<
  DecisionSurface,
  DecisionPolicyRule[]
> = {
  "qa-triage": ["qa-finding-level"],
  "draft-bar": ["review-verdict"],
  // The alternatives under evaluation carry the same rule: the label is
  // derived from the artifact's own verdict either way.
  "draft-bar-v2": ["review-verdict"],
  "draft-bar-v3": ["review-verdict"],
  "draft-bar-v4": ["review-verdict"],
  "motion-prescreen": ["motion-specificity"],
  "caption-overlap": ["caption-band"],
  // v0.12 (P5): the review agent's own per-section verdict.
  "review-verdict": ["section-verdict"],
};

/** The verdict the artifact itself recorded. For the `draft-bar` surface
 *  the label is DERIVED from these facts, so a label cannot drift away
 *  from the artifact it claims to encode. */
export interface DecisionSourceVerdict {
  /** The review's own `passing` flag. */
  passing?: boolean | undefined;
  /** The review raised a Critical finding, or a CRITICAL_BLOCKER flag. */
  critical?: boolean | undefined;
  /** The review raised a MAJOR_REVISION_NEEDED flag. */
  major_revision_needed?: boolean | undefined;
  /** The review agent's own per-section verdict (`pass` | `warn` |
   *  `fail`) — the `review-verdict` surface's label. */
  section_verdict?: string | undefined;
}

/** The `draft-bar` rule, as code: the artifact's own verdict decides
 *  the label, and the verdict is the LOOP'S OWN GATE
 *  (`passesBar` in packages/draft/src/article-review.ts) — a Critical
 *  finding blocks, everything else follows the review's `passing`
 *  flag. `MAJOR_REVISION_NEEDED` is ADVISORY: the loop ships drafts
 *  that carry it (six shipped artifacts hold `passing: true` plus the
 *  flag), so the rule must not read it as a revise.
 *
 *  (History: this rule first mapped the flag to `revise`. That misread
 *  the loop and made six artifacts contradict themselves — a
 *  `passing: true` draft labelled "revise". The fix aligned the rule
 *  with `passesBar`; the labels moved with it.) */
export function verdictToLabel(verdict: DecisionSourceVerdict): string {
  if (verdict.critical === true) return "reject";
  return verdict.passing ? "pass" : "revise";
}
