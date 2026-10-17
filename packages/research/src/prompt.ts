import type { ChatMessage } from "@video/llm";
import { loadPrompt } from "@video/prompts";
import type { WebSearchResult } from "./schemas.js";

export interface ResearchInput {
  topic: string;
  audience: string;
  language: "zh-CN" | "en-US";
  duration: number;
  webContext?: WebSearchResult[] | undefined;
}

/** Body lives in `packages/prompts/prompts/research.md` — edit it there. */
export const SYSTEM_PROMPT = loadPrompt("research");

export function buildMessages(input: ResearchInput): ChatMessage[] {
  const userParts = [
    `Topic: ${input.topic}`,
    `Audience: ${input.audience}`,
    `Language: ${input.language}`,
    `Total duration target (seconds): ${input.duration}`,
  ];
  if (input.webContext && input.webContext.length > 0) {
    userParts.push(
      "\n## Supporting web search results (cite by URL in claims)",
      ...input.webContext.map(
        (w, i) =>
          `[w${i + 1}] ${w.title} — ${w.url}\n    ${w.snippet.slice(0, 200)}`,
      ),
    );
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}
