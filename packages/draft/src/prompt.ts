import type { ChatMessage } from "@vf/llm";

export interface DraftInput {
  topic: string;
  audience: string;
  language: "zh-CN" | "en-US";
  duration: number;
  /** Optional pre-existing content to revise (used by `vf draft --from <file>`). */
  fromContent?: string;
  /** Optional web search results to ground the draft. */
  webContext?: { url: string; title: string; snippet: string }[];
}

export const SYSTEM_PROMPT = `You are the Article Drafter for AI Video Factory.

Output is JSON ONLY (no markdown, no code fences). Shape:

{
  "title": "<short title in the target language>",
  "hook": "<one-sentence opener for the video, ≤20s narration>",
  "sections": [
    { "heading": "<section heading, ≤3 words>", "body": "<1-3 sentence narrative body>" },
    { "heading": "...", "body": "..." }
  ],
  "scenes": [
    {
      "id": "scene_1",
      "duration": <int seconds>,
      "caption": "<short on-screen phrase>",
      "visual": "<one-line visual description>",
      "narration": "<multi-line spoken script for TTS>"
    }
  ]
}

Rules:
- 4-8 sections, 4-10 scenes.
- Sum of scene durations = duration_target_sec ± 5%.
- Each scene id is "scene_<N>" starting at 1, incrementing.
- narration reads aloud fluently (TTS-friendly). Use straight " or ".
- Total article language matches the requested language (zh-CN or en-US).
- Output JSON only — no commentary, no markdown.`;

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
  if (input.webContext && input.webContext.length > 0) {
    userParts.push(
      "\n## Supporting web search results (cite inside the article when relevant)",
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
