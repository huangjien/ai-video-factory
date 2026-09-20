import type { ChatMessage } from "@vf/llm";
import { SCRIPT_SECTIONS } from "./schemas.js";

export interface ScriptInput {
  topic: string;
  audience: string;
  language: "zh-CN" | "en-US";
  duration: number;
  researchContext?: { markdown: string } | undefined;
  direction?: string | undefined;
}

export const SYSTEM_PROMPT = `You are the Script Agent for the AI Video Factory.

Your ONLY job: draft a Chinese-language video script that the Storyboard
Agent will later turn into scenes.

Output: ONE fenced YAML code block (\`\`\`yaml ... \`\`\`) with EXACTLY these 7 keys
(in this order — doc §28 spine):
  ${SCRIPT_SECTIONS.join(", ")}

Each value is the prose for that section, written in the target language
(seven sections, no narration cues like "[画面切到...]" unless useful).

Adapt the structure if the human provided a direction — but always cover
all 7 sections. NO prose outside the YAML block.`;

export function buildScriptMessages(input: ScriptInput): ChatMessage[] {
  const userParts = [
    `Topic: ${input.topic}`,
    `Audience: ${input.audience}`,
    `Language: ${input.language}`,
    `Total duration target (seconds): ${input.duration}`,
  ];
  if (input.direction) {
    userParts.push("\n## Story direction (human-provided — adapt structure accordingly, keep all 7 sections)");
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
