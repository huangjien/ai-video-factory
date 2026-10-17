import type { ChatMessage } from "@video/llm";
import { fillPrompt, loadPrompt } from "@video/prompts";
import type { MotionSpec, SceneMotionInput } from "./plan.js";

/** Skill names whose guidance feeds the prompt when installed (T0.2). */
export const MOTION_SKILLS = [
  "animation-principles",
  "beat-sync-editing",
] as const;

/** Loaded at import time so the registry coverage test sees it. */
const MOTION_TEMPLATE = loadPrompt("motion");

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
  // Template lives in `packages/prompts/prompts/motion.md` — the skill
  // fallback sentence is assembly logic, so it stays here.
  const guidanceBlock = input.guidance
    ? `Motion guidance to follow:\n${input.guidance}`
    : "Skill guidance unavailable — rely on the schema rules and the baseline's timing.";

  const system: ChatMessage = {
    role: "system",
    content: fillPrompt(MOTION_TEMPLATE, {
      duration_sec: String(input.durationSec),
      guidance_block: guidanceBlock,
    }),
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
