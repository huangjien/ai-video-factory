import type { ChatMessage } from "@video/llm";
import { loadPrompt } from "@video/prompts";
import { withChannelBlock } from "./channel-profile.js";

export interface DraftInput {
  topic: string;
  audience: string;
  language: "zh-CN" | "en-US";
  duration: number;
  /** Improvement #4 (2026-11): editing-depth knob — how hard the drafter
   *  may edit source/idea material. Omitted → the base prompt behaves
   *  exactly as before (byte-identical user message). */
  editingDepth?: "light" | "medium" | "deep";
  /** Improvement #4 (2026-11): voice register for the article. Omitted →
   *  the drafter infers it from topic + audience as before. */
  tone?: "professional" | "conversational" | "academic" | "narrative";
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
  /** "image" = every scene gets a generated illustration (no component
   *  keywords); "components" = the default mixed register. Omitted →
   *  byte-identical prompt to the pre-flag one.
   *
   *  Why it exists: the drafter names the intended component in every
   *  `visual:` line ("…; stat keyword, …"), and the classifier routes
   *  on that bare word — so a film meant to be all photographs came out
   *  as geometry (50 of 57 scenes on 军种与兵种的组织文化, 2026-11-04).
   *  The fix used to be hand-editing ~30 visual lines per film. */
  visualMode?: "image" | "components";
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
  if (input.editingDepth !== undefined) {
    userParts.push(
      `Editing depth: ${input.editingDepth}`,
      input.editingDepth === "light"
        ? "Stay close to the source/idea material — polish wording, fix errors, tighten; do not restructure or add substantial new content."
        : input.editingDepth === "medium"
          ? "Balance fidelity to the source material with the article-quality rules above."
          : "Apply the full article-quality rules above, including reorganizing and expanding where the content needs it.",
    );
  }
  if (input.visualMode === "image") {
    userParts.push(
      "Visual mode: IMAGE-ONLY",
      'Every scene gets a GENERATED ILLUSTRATION (the image model renders the `visual:` line). Therefore: do NOT name a component, and do NOT include a style keyword — no "stat keyword", "流程关键词", "list keyword", "timeline", "引用", "金字塔" and so on. Those words silently route the scene to a self-rendered geometry component and it loses its picture.',
      "The ONLY keyword you may use is `takeaway` / `核心观点`, and only for a scene whose whole point IS the statement (it becomes the full-screen statement card).",
      "Write each `visual:` line as a pure art-direction sentence about the picture: subject, action, setting, material and light, micro-detail — and stop there.",
    );
  }
  if (input.tone !== undefined) {
    userParts.push(
      `Tone: ${input.tone}`,
      "Keep this voice register consistent from hook to conclusion.",
    );
  }
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
