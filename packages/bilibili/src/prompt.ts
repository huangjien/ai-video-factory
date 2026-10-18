import type { ChatMessage } from "@video/llm";
import { loadPrompt } from "@video/prompts";

export interface BilibiliInput {
  /** Full `article.md` — the narration is what the 简介 has to summarise. */
  article: string;
  /** The article's hook (first 1-3 sentences). Drives the emotional register
   * of the title and the cover. */
  hook?: string | undefined;
  /** Topic / working title. */
  topic?: string | undefined;
  /** The article's `image_style` preset, so the cover matches the video. */
  imageStyle?: string | undefined;
  /** Runtime in seconds, so the agent can write a 简介 that sets expectations
   * without claiming a length the render does not have. */
  durationSec?: number | undefined;
}

/** Body lives in `packages/prompts/prompts/bilibili.md` — edit it there. */
export const SYSTEM_PROMPT = loadPrompt("bilibili");

export function buildBilibiliMessages(input: BilibiliInput): ChatMessage[] {
  const userParts: string[] = [];
  // Style first on purpose: the cover must inherit the video's visual
  // identity, so the contract has to land before the agent invents one.
  if (input.imageStyle) {
    userParts.push("## Visual identity (the cover MUST match the video)");
    userParts.push(`Style preset: ${input.imageStyle}`);
    userParts.push("");
  }
  if (input.topic) {
    userParts.push(`## Topic: ${input.topic}`);
    userParts.push("");
  }
  if (input.durationSec !== undefined) {
    userParts.push(`## Runtime: ${Math.round(input.durationSec)} seconds`);
    userParts.push("");
  }
  if (input.hook) {
    userParts.push("## Hook (first 1-3 sentences — anchor the register)");
    userParts.push(input.hook);
    userParts.push("");
  }
  userParts.push("## Article (Markdown — narration and structure)");
  userParts.push(input.article.slice(0, 8000));
  userParts.push("");
  userParts.push("Produce the Bilibili package YAML.");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}
