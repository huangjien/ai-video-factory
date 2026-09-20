import type { ChatMessage } from "@vf/llm";
import type { WebSearchResult } from "./schemas.js";

export interface ResearchInput {
  topic: string;
  audience: string;
  language: "zh-CN" | "en-US";
  duration: number;
  webContext?: WebSearchResult[] | undefined;
}

export const SYSTEM_PROMPT = `You are the Research Agent for the AI Video Factory.

Your ONLY job: produce a research package on the given topic that a human
reviewer can read in under 5 minutes to fact-check the Storyboard Agent's
later draft.

Output: ONE fenced YAML code block (\`\`\`yaml ... \`\`\`) with EXACTLY these keys:
  markdown:   string (the research.md narrative, see format below)
  sources:    array of {id, url, title, accessed, snippet}
  claims:     array of {id, claim, status, sources, note?}
  meta:       {web_search_used, web_search_failed, provider, model}

research.md format:
- Start with a "## Needs human review" section listing claim IDs whose
  status is "uncertain" or "needs_human". If none, write "(none)".
- Then "## Overview" with 2-3 paragraphs framing the topic.
- Then "## Key claims" with each claim numbered and tagged inline:
    [fact] The sky is blue. (sources: s1)
    [opinion] Blue is calming. (sources: s3)
    [uncertain] Some claim we couldn't verify. (sources: s1, s2)
    [needs_human] Some claim that needs a domain expert to confirm.
- For contested topics, present AT LEAST TWO alternative viewpoints.
- Distinguish fact from opinion explicitly. NEVER state an opinion as fact.

claims.yaml: each claim must reference sources by their id. A fact claim
must have at least one source. An opinion may have zero sources.

NO prose outside the fenced YAML block. Output ONLY the code block.`;

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
