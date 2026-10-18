import type { ChatMessage } from "@video/llm";
import {
  fillPrompt,
  loadPrompt,
  loadAndValidateBgmCatalogue,
  renderBgmCatalogue,
} from "@video/prompts";
import type { ParsedArticle } from "@video/draft";

export interface AudioPlanInput {
  article: ParsedArticle;
  /** Optional existing audio-config.yaml content (when revising). */
  fromContent?: string;
  language: "zh-CN" | "en-US";
}

/** Body lives in `packages/prompts/prompts/audio-plan.md` — edit it there.
 *  `{{BGM_CATALOGUE}}` is filled from `music.json`, which indexes the real
 *  files in `assets/bgm/`; the planner must choose a tag from it rather
 *  than invent one, because no music is generated any more. The
 *  catalogue is loaded through `loadAndValidateBgmCatalogue` so a
 *  missing file surfaces here at module-init time, not at mix time. */
export const SYSTEM_PROMPT = fillPrompt(loadPrompt("audio-plan"), {
  BGM_CATALOGUE: renderBgmCatalogue(loadAndValidateBgmCatalogue().catalogue),
});

export function buildMessages(input: AudioPlanInput): ChatMessage[] {
  const sceneSummary = input.article.scenes
    .map((s) => `- ${s.id} (${s.duration}s): ${s.caption} — ${s.visual}`)
    .join("\n");
  // First heading of the prose body (frontmatter already stripped by the
  // parser); falls back to the project id when no heading exists.
  const title =
    input.article.proseBody
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith(">"))
      ?.replace(/^#\s*/, "") ?? input.article.frontmatter.project;
  const userParts = [
    `Article title: ${title}`,
    `Language: ${input.language}`,
    `Total scenes: ${input.article.scenes.length}`,
    "",
    "Scenes:",
    sceneSummary,
  ];
  if (input.fromContent) {
    userParts.push(
      "",
      "## Existing audio-config.yaml to revise (preserve intent, improve as needed)",
      input.fromContent,
    );
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}
