import type { ChatMessage } from "@video/llm";
import { loadPrompt } from "@video/prompts";

export interface ReviewInput {
  storyboard: string;
  script: string;
  claims: string;
}

/** Body lives in `packages/prompts/prompts/review.md` — edit it there. */
export const SYSTEM_PROMPT = loadPrompt("review");

/** Artifacts are handed to the judge WHOLE.
 *
 *  The builder used to slice each one to 4000 characters. On a 16-scene
 *  film that cut the storyboard mid-scene-07 — and the judge read the
 *  cut as a storyboard that ENDS there, filing a critical
 *  "contradiction" about a film that was in fact complete. A silent
 *  truncation of the evidence turns into a false defect report, which
 *  is worse than no review at all.
 *
 *  A generous cap remains as a guard against a pathological artifact.
 *  When it bites, the cut is MARKED, so the judge treats it as a limit
 *  of the evidence rather than a defect in the project. 60k characters
 *  covers every shipped project (the largest storyboard is ~41k) with
 *  room for a 40-scene film. */
const ARTIFACT_CHAR_LIMIT = 60_000;

function clipArtifact(label: string, text: string): string {
  if (text.length <= ARTIFACT_CHAR_LIMIT) return text;
  return (
    text.slice(0, ARTIFACT_CHAR_LIMIT) +
    `\n\n[TRUNCATED: only the first ${ARTIFACT_CHAR_LIMIT} of ${text.length} characters of the ${label} were supplied. ` +
    `Content beyond this point was NOT reviewed — do NOT report the missing content as a defect, ` +
    `and do NOT infer that the artifact ends here.]`
  );
}

export function buildReviewMessages(input: ReviewInput): ChatMessage[] {
  const userParts = [
    "## Storyboard (VDSL)",
    clipArtifact("storyboard", input.storyboard),
    "\n## Script (Markdown)",
    clipArtifact("script", input.script),
    "\n## Claims (YAML)",
    clipArtifact("claims", input.claims),
    "\nProduce the review package YAML.",
  ];
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}
