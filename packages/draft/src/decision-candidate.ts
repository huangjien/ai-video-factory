/**
 * The shared shape of a candidate corpus case.
 *
 * A candidate is what the harvest produces: a case built from a real
 * production artifact, with its label either PROPOSED (a model answered
 * and a human has to rule) or DERIVED (a rule decides it from the
 * artifact). The corpus loader checks the derived ones against the rule,
 * so a derived candidate can be moved into the corpus unchanged.
 */
export interface DecisionCandidate {
  id: string;
  surface: "visual-class" | "draft-bar";
  /** The real state — always recovered from the artifact, never copied
   *  out of a log (the log keeps only a hash of it). */
  state: string;
  expects: { kind: "choice"; value: string };
  /** What today's deterministic path answered, when there is one. */
  baseline?: string | undefined;
  /** True when a human still has to rule on the label. */
  disputed: boolean;
  /** Why the label is arguable — required when `disputed` is true. */
  dispute?: string | undefined;
  policy: { rule: string; note: string };
  /** The verdict facts, when the label is derived from them. */
  source_verdict?: {
    passing: boolean;
    critical?: boolean | undefined;
    major_revision_needed?: boolean | undefined;
  } | undefined;
  provenance: { source: string };
}

/** A corpus case id. Letters and digits of ANY script survive — a CJK
 *  project name must not collapse to an empty string, or every Chinese
 *  project would claim the same id. */
export function candidateId(...parts: (string | number)[]): string {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
