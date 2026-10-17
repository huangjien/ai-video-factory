import type { ChatMessage } from "@video/llm";
import { fillPrompt, loadPrompt } from "@video/prompts";
import { SCRIPT_SECTIONS } from "./schemas.js";

export interface ScriptInput {
  topic: string;
  audience: string;
  language: "zh-CN" | "en-US";
  duration: number;
  researchContext?: { markdown: string } | undefined;
  direction?: string | undefined;
}

/** Body lives in `packages/prompts/prompts/script.md` (with a
 *  `{{script_sections}}` placeholder) — edit it there. */
export const SYSTEM_PROMPT = fillPrompt(loadPrompt("script"), {
  script_sections: SCRIPT_SECTIONS.join(", "),
});

export function buildScriptMessages(input: ScriptInput): ChatMessage[] {
  const userParts = [
    `Topic: ${input.topic}`,
    `Audience: ${input.audience}`,
    `Language: ${input.language}`,
    `Total duration target (seconds): ${input.duration}`,
  ];
  if (input.direction) {
    userParts.push(
      "\n## Story direction (human-provided — adapt structure accordingly, keep all 7 sections)",
    );
    userParts.push(input.direction);
  }
  if (input.researchContext) {
    userParts.push(
      "\n## Supporting research (cite and weigh — do not repeat verbatim)",
      input.researchContext.markdown.slice(0, 2500),
    );
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}
