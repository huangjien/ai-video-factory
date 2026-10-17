import type { ChatMessage } from "@video/llm";
import { loadPrompt } from "@video/prompts";

export interface AgentInput {
  topic: string;
  audience: string;
  duration: number;
  language: "zh-CN" | "en-US";
  style: string;
  researchContext?: { markdown: string; claimSummary: string } | undefined;
  scriptContext?: { markdown: string } | undefined;
}

/** Body lives in `packages/prompts/prompts/storyboard.md` (incl. the two
 *  few-shot examples) — edit it there. */
export const SYSTEM_PROMPT = loadPrompt("storyboard");

export function buildMessages(input: AgentInput): ChatMessage[] {
  const userParts = [
    `Topic: ${input.topic}`,
    `Audience: ${input.audience}`,
    `Language: ${input.language}`,
    `Total duration target (seconds): ${input.duration}`,
    `Style: ${input.style}`,
  ];
  if (input.researchContext) {
    userParts.push(
      "\n## Supporting research (from approved `video research` output — supporting evidence, not a replacement for your draft)",
      input.researchContext.markdown.slice(0, 2000),
      "\n### Key claims to incorporate or counter",
      input.researchContext.claimSummary.slice(0, 1500),
    );
  }
  if (input.scriptContext) {
    userParts.push(
      "\n## Approved script (from `video script` — map each scene to a section)",
      input.scriptContext.markdown.slice(0, 3000),
    );
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}
