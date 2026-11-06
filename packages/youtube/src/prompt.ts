import type { ChatMessage } from "@video/llm";
import { loadPrompt } from "@video/prompts";

export interface YouTubeInput {
  storyboard: string;
  /** The article's frontmatter language ("zh-CN" / "en-US"). Passed through
   *  so EVERY user-facing string is written in it — the model otherwise
   *  drifts to Chinese even when all materials are English (glm,
   *  en-US l10n films, 2026-11-04). */
  language?: string | undefined;
  script: string;
  research: string;
  /** v0.4 (T4): the article's hook (first 1-3 sentences). Drives the
   *  emotional tone of `thumbnail_prompt`. Optional for back-compat. */
  hook?: string;
  /** v0.4 (T4): the topic / title of the video. Echoed in `title`. */
  topic?: string;
  /** v0.10.3: the article's `image_style` preset. The thumbnail is the
   *  video's shop window: if the scenes are editorial-illustration and the
   *  thumbnail is cinematic-35mm photography, the video looks like two
   *  different products. Optional for back-compat. */
  imageStyle?: string | undefined;
  /** v0.10.3: the article's declared era/region/culture. The thumbnail gets
   *  the same anchoring the scene briefs get — an unanchored historical
   *  thumbnail renders in the image model's default period, which is usually
   *  Western medieval. */
  setting?: string | undefined;
}

/** Body lives in `packages/prompts/prompts/youtube.md` — edit it there. */
export const SYSTEM_PROMPT = loadPrompt("youtube");

export function buildYouTubeMessages(input: YouTubeInput): ChatMessage[] {
  const userParts: string[] = [];
  // First block on purpose: the thumbnail inherits the video's visual
  // identity, so the style contract has to arrive before the agent writes a
  // "[style modifier]" of its own invention.
  if (input.imageStyle || input.setting) {
    userParts.push("## Visual identity (the thumbnail MUST match the video)");
    if (input.imageStyle) {
      userParts.push(`Style preset: ${input.imageStyle}`);
    }
    if (input.setting) {
      userParts.push(`Setting (era / region / culture): ${input.setting}`);
    }
    userParts.push("");
  }
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
  // Explicit output-language anchor. Content-language inference is not
  // reliable across models: an en-US l10n package kept coming back in
  // Chinese because the research excerpt carried one zh token (the
  // canonical project slug in the frontmatter).
  if (input.language) {
    const langName = input.language.toLowerCase().startsWith("en")
      ? "English"
      : "Chinese";
    userParts.push(
      `## Output language (mandatory)\n\nWrite EVERY user-facing string — title, description, chapter titles, thumbnail_prompt, shorts_hook — in ${langName} (${input.language}). Ignore any other language signal in the materials above.`,
    );
    userParts.push("");
  }
  userParts.push("Produce the YouTube package YAML.");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}
