import type { ChatMessage } from "@video/llm";
import type { MotionSpec, SceneMotionInput } from "./plan.js";

/** Skill names whose guidance feeds the prompt when installed (T0.2). */
export const MOTION_SKILLS = [
  "animation-principles",
  "beat-sync-editing",
] as const;

export interface MotionAgentSceneInput {
  sceneId: string;
  durationSec: number;
  index: number;
  component: string;
  narrationText?: string;
  /** Truncated JSON of the scene's visual props — context, not contract. */
  propsSummary?: string;
  targets?: string[];
  beatsPerMinute?: number;
  /** The deterministic baseline the agent should improve on. */
  baseline: MotionSpec;
  /** Skill guidance text (adapter), already truncated by the caller. */
  guidance: string | null;
}

export function buildMotionMessages(
  input: MotionAgentSceneInput,
): ChatMessage[] {
  const schemaRules = [
    "Output ONLY a ```yaml fenced block with this exact shape:",
    "animations:",
    "  - id: <unique-id>",
    "    target: <element id>",
    "    type: draw|write|fade|move|scale|rotate|highlight|morph|camera",
    "    start: <seconds, >= 0>",
    "    duration: <seconds, > 0>",
    "    easing: linear|easeIn|easeOut|easeInOut",
    "transition:",
    "  in: fade|cut",
    "  out: fade|cut",
    `HARD RULES: every start+duration must fit inside the scene's ${input.durationSec}s; ids unique; 2-5 animations total; at most one highlight; no unknown keys; omit nothing.`,
    input.guidance
      ? `Motion guidance to follow:\n${input.guidance}`
      : "Skill guidance unavailable — rely on the schema rules and the baseline's timing.",
  ].join("\n");

  const system: ChatMessage = {
    role: "system",
    content: `You are the Motion Agent of a deterministic video pipeline. You design per-scene motion (timeline animations + transition) for explainer scenes rendered by Remotion. Motion craft rules: entrances use ease-out, exits ease-in, moves ease-in-out; stagger groups 40-80ms per item capped at ~0.7s total; keep entrances at most a third of the scene; land key moments on the beat when a BPM is given. ${schemaRules}`,
  };

  const user: ChatMessage = {
    role: "user",
    content: JSON.stringify(
      {
        scene: {
          id: input.sceneId,
          durationSec: input.durationSec,
          index: input.index,
          component: input.component,
          ...(input.narrationText !== undefined
            ? { narration: input.narrationText }
            : {}),
          ...(input.propsSummary !== undefined
            ? { props: input.propsSummary }
            : {}),
          ...(input.targets ? { targets: input.targets } : {}),
          ...(input.beatsPerMinute !== undefined
            ? { beatsPerMinute: input.beatsPerMinute }
            : {}),
        },
        baseline: input.baseline,
      },
      null,
      2,
    ),
  };

  return [system, user];
}
