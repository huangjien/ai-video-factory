import type { ChatMessage } from "@video/llm";
import { fillPrompt, loadPrompt } from "@video/prompts";
import type { MotionSpec, SceneMotionInput } from "./plan.js";
import { isStillFirstProfile } from "./plan.js";

/** Skill names whose guidance feeds the prompt when installed (T0.2). */
export const MOTION_SKILLS = [
  "animation-principles",
  "beat-sync-editing",
] as const;

/** Loaded at import time so the registry coverage test sees it. */
const MOTION_TEMPLATE = loadPrompt("motion");
/** CS-09 still-first block. Also import-time: prompt-registry.test.ts
 *  asserts every file on disk is loaded by an import-time loader, and a
 *  lazy load inside buildMotionMessages would read as an orphan. */
const MOTION_STILL_FIRST_BLOCK = loadPrompt("motion-channel-chinese-storybook");
/** The Laya decision prompt: "is the deterministic baseline good enough,
 *  or does this scene need the Motion Agent?" Also import-time, for the
 *  same reason. */
const MOTION_LAYA_INSTRUCTIONS = loadPrompt("motion-laya");

/** The instructions for the Laya motion pre-screen decision.
 *
 *  Owned by @video/motion so the prompt lives beside the other motion
 *  prompts — the decision is about motion, and the registry coverage
 *  test loads this package. */
export const MOTION_LAYA_PROMPT = MOTION_LAYA_INSTRUCTIONS;

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
  /** CS-09: channel profile. Appended last so its still-first rules
   *  override the template's default "2-5 animations" quota. */
  channelProfile?: string;
}

export function buildMotionMessages(
  input: MotionAgentSceneInput,
): ChatMessage[] {
  // Template lives in `packages/prompts/prompts/motion.md` — the skill
  // fallback sentence is assembly logic, so it stays here.
  const skillBlock = input.guidance
    ? `Motion guidance to follow:\n${input.guidance}`
    : "Skill guidance unavailable — rely on the schema rules and the baseline's timing.";
  // CS-09: the profile block goes LAST so its still-first rules win over
  // the template's default "2-5 animations" quota.
  const profileBlock = isStillFirstProfile(input.channelProfile)
    ? MOTION_STILL_FIRST_BLOCK
    : null;
  const guidanceBlock =
    profileBlock === null ? skillBlock : `${skillBlock}\n\n${profileBlock}`;

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
