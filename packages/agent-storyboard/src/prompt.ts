import type { ChatMessage } from "@vf/llm";

export interface AgentInput {
  topic: string;
  audience: string;
  duration: number;
  language: "zh-CN" | "en-US";
  style: string;
  researchContext?: { markdown: string; claimSummary: string } | undefined;
}

const FEWSHOT_SAMPLE = `schema_version: "0.1"
project:
  id: ai-cot
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080
style:
  theme: dark-tech
scenes:
  - id: scene-01
    duration: 8
    narration:
      text: "AI Agent 为什么需要 Memory？"
    visual:
      component: Title
      props:
        text: "AI Agent 为什么需要 Memory？"
    animation:
      entrance: fade
    captions:
      source: narration`;

const FLOWCHART_EXAMPLE = `  - id: scene-02
    duration: 8
    visual:
      component: FlowChart
      props:
        nodes: ["问题", "步骤 1", "答案"]
        edges: [[0,1], [1,2]]
        direction: left-to-right
    animation:
      entrance: draw`;

export const SYSTEM_PROMPT = `You are the Storyboard Agent for the AI Video Factory.

Your ONLY job: produce a valid VDSL 0.1 storyboard.yaml for the given topic.

Rules:
1. Output strictly one fenced YAML code block (\`\`\`yaml ... \`\`\`).
2. Use schema_version: "0.1".
3. Use the dark-tech theme (theme: dark-tech).
4. Use components from this registered set ONLY:
   Title, Paragraph, CodeBlock, Terminal, Image, FlowChart, Comparison,
   Timeline, Callout, EndCard.
5. Visual durations are in SECONDS; scene count 5-8; total duration <= 60.
6. Each scene needs: id (snake_case), duration, visual.component+props.
   Optional: narration.text/audio, animation.entrance, captions.source.
7. NO prose outside the YAML code block.

Few-shot example:
${FEWSHOT_SAMPLE}
${FLOWCHART_EXAMPLE}`;

export function buildMessages(input: AgentInput): ChatMessage[] {
  const userParts = [
    `Topic: ${input.topic}`,
    `Audience: ${input.audience}`,
    `Language: ${input.language}`,
    `Total duration target (seconds): ${input.duration}`,
    `Style: ${input.style}`,
  ];
  if (input.researchContext) {
    userParts.push(
      "\n## Supporting research (from approved `vf research` output — supporting evidence, not a replacement for your draft)",
      input.researchContext.markdown.slice(0, 2000),
      "\n### Key claims to incorporate or counter",
      input.researchContext.claimSummary.slice(0, 1500),
    );
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}
