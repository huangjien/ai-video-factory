import type { ChatMessage } from "@vf/llm";
import type { ParsedArticle } from "@vf/draft";

export interface AudioPlanInput {
  article: ParsedArticle;
  /** Optional existing audio-config.yaml content (when revising). */
  fromContent?: string;
  language: "zh-CN" | "en-US";
}

export const SYSTEM_PROMPT = `You are the Audio Planner for AI Video Factory.

Given a parsed article (frontmatter, scenes), propose ONE audio-config.yaml
that a human reviewer can edit in 5 seconds. Output is JSON ONLY (no
markdown, no code fences).

Shape:

{
  "voice": "<Edge TTS voice ID, e.g. zh-CN-YunjianNeural (male, default) or en-US-ChristopherNeural (male, default); female alternatives zh-CN-XiaoxiaoNeural, en-US-AriaNeural>",
  "bgm": "<bgm tag like 'calm' or null to disable>",
  "bgm_fade_in_sec": <number 0..10>,
  "bgm_fade_out_sec": <number 0..10>,
  "pause_between_sentences_sec": <number 0..5, typically 0.5–1.5 for natural pacing, 0 to disable>,
  "sfx": {
    "scene_<N>": "<sfx tag like 'whoosh' or 'ding'>",
    ...
  }
}

Rules:
- Only suggest SFX on scene boundaries or section transitions, never mid-scene.
- Use 0-3 SFX cues total. Most videos need only 1-2.
- Default voice: zh-CN-YunjianNeural (zh-CN) or en-US-ChristopherNeural (en-US).
  Female alternatives: zh-CN-XiaoxiaoNeural, en-US-AriaNeural.
- Default bgm: 'calm' unless the article mood demands something else.
- Fade timings: bgm_fade_in 1-3s typical, bgm_fade_out 1.5-3s typical.
- pause_between_sentences_sec: 0 by default. Suggest 0.5–1.0 when the article has multiple sentences per scene and you want clearer pacing; omit (defaults to 0) for short single-sentence narrations.
- DO NOT add sfx for every scene. Quality over quantity.
- Output JSON only — no commentary, no markdown.`;

export function buildMessages(input: AudioPlanInput): ChatMessage[] {
  const sceneSummary = input.article.scenes
    .map((s) => `- ${s.id} (${s.duration}s): ${s.caption} — ${s.visual}`)
    .join("\n");
  const userParts = [
    `Article title: ${input.article.markdown.split("\n")[0]?.replace(/^---[\s\S]*?---\n/, "").split("\n")[0] ?? ""}`,
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
