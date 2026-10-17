import type { ChatMessage } from "@video/llm";
import { loadPrompt } from "@video/prompts";

export interface ReviewInput {
  storyboard: string;
  script: string;
  claims: string;
}

/** Body lives in `packages/prompts/prompts/review.md` — edit it there. */
export const SYSTEM_PROMPT = loadPrompt("review");

export function buildReviewMessages(input: ReviewInput): ChatMessage[] {
  const userParts = [
    "## Storyboard (VDSL)",
    input.storyboard.slice(0, 4000),
    "\n## Script (Markdown)",
    input.script.slice(0, 4000),
    "\n## Claims (YAML)",
    input.claims.slice(0, 2000),
    "\nProduce the review package YAML.",
  ];
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}
