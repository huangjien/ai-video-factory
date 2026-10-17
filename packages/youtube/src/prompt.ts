import type { ChatMessage } from "@video/llm";
import { loadPrompt } from "@video/prompts";

export interface YouTubeInput {
  storyboard: string;
  script: string;
  research: string;
  /** v0.4 (T4): the article's hook (first 1-3 sentences). Drives the
   *  emotional tone of `thumbnail_prompt`. Optional for back-compat. */
  hook?: string;
  /** v0.4 (T4): the topic / title of the video. Echoed in `title`. */
  topic?: string;
}

/** Body lives in `packages/prompts/prompts/youtube.md` — edit it there. */
export const SYSTEM_PROMPT = loadPrompt("youtube");

export function buildYouTubeMessages(input: YouTubeInput): ChatMessage[] {
  const userParts: string[] = [];
  if (input.hook) {
    userParts.push("## Hook (first 1-3 sentences — anchor the emotional tone)");
    userParts.push(input.hook);
    userParts.push("");
  }
  if (input.topic) {
    userParts.push(`## Topic: ${input.topic}`);
    userParts.push("");
  }
  userParts.push("## Storyboard (VDSL)");
  userParts.push(input.storyboard.slice(0, 4000));
  userParts.push("");
  userParts.push("## Script (Markdown)");
  userParts.push(input.script.slice(0, 4000));
  userParts.push("");
  userParts.push("## Research (excerpt — sources for description citations)");
  userParts.push(input.research.slice(0, 2000));
  userParts.push("");
  userParts.push("Produce the YouTube package YAML.");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}
