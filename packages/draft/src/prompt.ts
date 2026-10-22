import type { ChatMessage } from "@video/llm";
import { loadPrompt } from "@video/prompts";
import { withChannelBlock } from "./channel-profile.js";

export interface DraftInput {
  topic: string;
  audience: string;
  language: "zh-CN" | "en-US";
  duration: number;
  /** Optional pre-existing content to revise (used by `video draft --from <file>`). */
  fromContent?: string;
  /** Optional raw idea / outline seed (used by `video draft --file <path>`).
   *  The LLM treats it as the user's own idea: polish the wording, never
   *  change the opinions. */
  ideaSeed?: string;
  /** Optional web search results to ground the draft. */
  webContext?: { url: string; title: string; snippet: string }[];
  /** Judge feedback from a rejected previous draft (scored below the
   *  acceptance bar). The drafter must fix these findings in the rewrite. */
  feedback?: string;
  /** CS-03: channel grammar profile. Appends the profile's narrator /
   *  pacing / arc rules to the system prompt. Unknown or omitted → the
   *  system prompt is byte-identical to the pre-profile one. */
  channelProfile?: string;
}

/** Body lives in `packages/prompts/prompts/draft-article.md` — edit it there. */
export const SYSTEM_PROMPT = loadPrompt("draft-article");

export function buildMessages(input: DraftInput): ChatMessage[] {
  const userParts = [
    `Topic: ${input.topic}`,
    `Audience: ${input.audience}`,
    `Language: ${input.language}`,
    `Total duration target (seconds): ${input.duration}`,
  ];
  if (input.fromContent) {
    userParts.push(
      "\n## Existing content to revise (preserve intent, improve as needed)",
      input.fromContent,
    );
  }
  if (input.ideaSeed) {
    userParts.push(
      "\n## The user's major idea (from --file)",
      "The following is the user's own idea and opinions. You may polish the",
      "wording, structure, flow, and completeness — but do NOT change,",
      "contradict, soften, or replace any opinion it expresses. The finished",
      "article must stay faithful to this idea; where you add supporting",
      "material, it must serve this idea, not steer away from it.",
      "",
      input.ideaSeed,
    );
  }
  if (input.webContext && input.webContext.length > 0) {
    userParts.push(
      "\n## Supporting web search results (cite inside the article when relevant)",
      ...input.webContext.map(
        (w, i) =>
          `[w${i + 1}] ${w.title} — ${w.url}\n    ${w.snippet.slice(0, 200)}`,
      ),
    );
  }
  if (input.feedback) {
    userParts.push(
      "\n## Revision feedback — the previous draft was rejected by the quality judge",
      input.feedback,
    );
  }
  return [
    {
      role: "system",
      content: withChannelBlock(SYSTEM_PROMPT, input.channelProfile, "draft"),
    },
    { role: "user", content: userParts.join("\n") },
  ];
}
