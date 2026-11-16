/**
 * The decision-question registry.
 *
 * A decision question is a PROMPT like any other: it lives as a file
 * under `packages/prompts/prompts/` and is loaded through the registry.
 * What makes it a decision question is the shape around it — the kind
 * (`choice` / `score` / `noul`), the option list, the level list — which
 * is metadata the prompt file cannot carry.
 *
 * Keeping the wording, the options and the criteria in ONE place is the
 * whole point: the question is the thing a human audits and edits, and
 * every provider must be asked exactly the same question or the
 * benchmark compares prompts instead of providers.
 *
 * The bodies are loaded eagerly at module scope so the registry
 * coverage test (packages/cli/src/prompt-registry.test.ts) sees them:
 * a question file nobody loads is an orphan, and an orphan question is
 * a question that silently drifts from the one the pipeline asks.
 */
import { loadPrompt } from "./prompt-loader.js";

export type DecisionSurface =
  | "qa-triage"
  | "draft-bar"
  | "draft-bar-v2"
  | "draft-bar-v3"
  | "draft-bar-v4"
  | "motion-prescreen"
  | "caption-overlap"
  | "review-verdict";

export interface DecisionQuestionSpec {
  /** The surface id — also the corpus directory name. */
  surface: DecisionSurface;
  /** The prompt file stem under `prompts/`. */
  prompt: string;
  kind: "choice" | "score" | "noul";
  /** True when the surface was measured and RETIRED: it keeps its
   *  question body and its corpus cases (the measurement is the
   *  deliverable, and the corpus is the durable copy of the shipped
   *  artifacts the cases came from), but it is not wired into any
   *  command and it does not GATE the provider choice.
   *
   *  A retired surface exists because a surface that measured at chance
   *  must not drag the corpus-wide gate down with it: the gate answers
   *  "can this provider carry the surfaces the pipeline actually
   *  consults?", and a retired surface is not one of them. */
  retired?: boolean | undefined;
  /** `choice`: the allowed options, in the order they are offered. */
  options?: string[] | undefined;
  /** `choice`: what each option means. */
  optionHints?: Record<string, string> | undefined;
  /** `score`: the ordered level descriptions. */
  levels?: string[] | undefined;
  /** `noul`: what a true answer means. */
  trueMeaning?: string | undefined;
  /** `noul`: what a false answer means. */
  falseMeaning?: string | undefined;
  /** The property that carries the answer in a function-call schema. */
  resultProperty?: string | undefined;
}

/** Every decision question the pipeline knows. */
export const DECISION_QUESTIONS: Record<DecisionSurface, DecisionQuestionSpec> =
  {
    "qa-triage": {
      surface: "qa-triage",
      prompt: "decision-qa-triage",
      kind: "choice",
      options: ["pass", "review", "block"],
      optionHints: {
        pass: "cosmetic or informational — the video can ship unchanged",
        review:
          "a human should look before publishing, but the video is watchable",
        block: "the rendered video is unusable as published",
      },
      resultProperty: "verdict",
    },
    "draft-bar": {
      surface: "draft-bar",
      prompt: "decision-draft-bar",
      kind: "choice",
      options: ["pass", "revise", "reject"],
      optionHints: {
        pass: "publishable as it stands",
        revise: "holds together, but specific parts fail",
        reject: "needs rewriting, not editing",
      },
      resultProperty: "verdict",
    },
    // The three ALTERNATIVES from the 2026-11-14 wording experiment
    // (scripts/experiment-decision-question.mjs). The production wording
    // read the model one notch stricter than the review's own verdict —
    // 108 of 174 real consults answered "reject" where the review said
    // "revise". v3 (severity-anchored: name the severity each verdict
    // corresponds to, and say a Major finding means "fix this part", not
    // "rewrite the draft") tripled the verdict accuracy: 29.5% → 82.4%.
    // Its content is now the production wording (decision-draft-bar.md);
    // the variants stay registered so the experiment stays runnable and
    // the parity test keeps their bodies honest.
    "draft-bar-v2": {
      surface: "draft-bar-v2",
      prompt: "decision-draft-bar-v2",
      kind: "choice",
      options: ["pass", "revise", "reject"],
      optionHints: {
        pass: "it ships as it stands; an editor would change wording, not substance",
        revise:
          "most of it survives; some sections are wrong, unsupported, or missing",
        reject: "less than half survives; the draft has to be written again",
      },
      resultProperty: "verdict",
    },
    "draft-bar-v3": {
      surface: "draft-bar-v3",
      prompt: "decision-draft-bar-v3",
      kind: "choice",
      options: ["pass", "revise", "reject"],
      optionHints: {
        pass: "nothing worse than Minor findings",
        revise: "Major or Moderate findings, and no Critical one",
        reject:
          "a Critical finding: a wrong fact, an unsupported claim, or a broken structure",
      },
      resultProperty: "verdict",
    },
    "draft-bar-v4": {
      surface: "draft-bar-v4",
      prompt: "decision-draft-bar-v4",
      kind: "choice",
      options: ["pass", "revise", "reject"],
      optionHints: {
        pass: "shipped",
        revise:
          "sent back for a revision pass; the editor fixes the failing parts",
        reject: "sent back to be written again",
      },
      resultProperty: "verdict",
    },
    "caption-overlap": {
      surface: "caption-overlap",
      prompt: "decision-caption-overlap",
      kind: "noul",
      trueMeaning:
        "two pieces of text are drawn in the bottom band at the same time",
      falseMeaning: "the caption sits alone in the bottom band",
      resultProperty: "overlaps",
    },
    "motion-prescreen": {
      surface: "motion-prescreen",
      prompt: "decision-motion-prescreen",
      kind: "choice",
      options: ["keep", "refine"],
      optionHints: {
        keep: "the plan already matches the scene; a second pass changes nothing",
        refine: "the plan is generic or contradicts the scene",
      },
      resultProperty: "verdict",
      // RETIRED 2026-11-16 (v0.12 P1): measured 47/92 = 0.511 on a
      // balanced corpus built from 26 shipped storyboards — chance. The
      // label is derived from the shipped plan's animation targets, and
      // in 475 of the 482 `refine` cases those targets are renderer-
      // internal ids (`__title__`, `event-1979`) that appear nowhere in
      // the scene's props: the state does not carry the fact the label is
      // derived from, so no wording fixes it. The cases stay (they are the
      // durable copy of the measurement); the surface is not wired and
      // does not gate the provider choice.
      retired: true,
    },
    // v0.12 (P5): the `video review` agent's own per-section verdict. The
    // label is DERIVED from the artifact's `overall` field — the same
    // principle as draft-bar, read from a different artifact.
    "review-verdict": {
      surface: "review-verdict",
      prompt: "decision-review-verdict",
      kind: "choice",
      options: ["pass", "warn", "fail"],
      optionHints: {
        pass: "the section found nothing that needs attention",
        warn: "a human should look before publishing, but the work is usable",
        fail: "the section found something that makes the work unusable as it stands",
      },
      resultProperty: "verdict",
    },
  };

const bodies = new Map<DecisionSurface, string>();
for (const spec of Object.values(DECISION_QUESTIONS)) {
  bodies.set(spec.surface, loadPrompt(spec.prompt));
}

/** The wording of one decision question. */
export function loadDecisionQuestion(surface: DecisionSurface): string {
  const body = bodies.get(surface);
  if (body === undefined) {
    throw new Error(`unknown decision surface: ${surface}`);
  }
  return body;
}

/** Every surface id, sorted. */
export function listDecisionSurfaces(): DecisionSurface[] {
  return Object.keys(DECISION_QUESTIONS).sort() as DecisionSurface[];
}

/** True when the surface was measured and retired — it keeps its
 *  corpus cases but does not gate the provider choice. */
export function isRetiredSurface(surface: DecisionSurface): boolean {
  return DECISION_QUESTIONS[surface]?.retired === true;
}
