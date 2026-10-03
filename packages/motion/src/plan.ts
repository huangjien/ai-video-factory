import { ANIMATION_TYPES, EASINGS, type TimelineAnimation } from "@video/vdsl";
import {
  clampDuration,
  EMPHASIS_AT_FRACTION,
  EMPHASIS_DURATION_SEC,
  EMPHASIS_MIN_SCENE_SEC,
  ENTRANCE_DELAY_SEC,
  entranceTypeForComponent,
  quantizeToBeat,
  STAGGER,
} from "./heuristics.js";

/**
 * Deterministic motion planning (plan T4.1): scene facts in, MotionSpec
 * out — no LLM, no skills required. The T4.2 Motion Agent uses this as the
 * baseline and edits/extends the result with skill guidance; the pipeline
 * falls back to this verbatim when neither is available (AD-5).
 */

export type TransitionKind = "fade" | "cut";

export interface MotionSpec {
  animations: TimelineAnimation[];
  transition: { in: TransitionKind; out: TransitionKind };
}

export interface SceneMotionInput {
  sceneId: string;
  durationSec: number;
  /** Position in the storyboard — reserved for scene-variety rules. */
  index: number;
  /** Registry component name (drives the entrance type). */
  component: string;
  narrationText?: string;
  /** Element ids inside the scene to animate; default = the scene root. */
  targets?: string[];
  /** Optional beat grid (e.g. 120) — entrance/emphasis snap to beats. */
  beatsPerMinute?: number;
}

/** Plan motion for one scene. Throws when the input cannot produce a legal
 * spec (non-positive duration). */
export function planSceneMotion(input: SceneMotionInput): MotionSpec {
  if (!(input.durationSec > 0)) {
    throw new Error(`planSceneMotion: scene ${input.sceneId} has non-positive duration`);
  }
  const targets = input.targets && input.targets.length > 0 ? input.targets : [input.sceneId];
  const animations: TimelineAnimation[] = [];

  const entranceType = entranceTypeForComponent(input.component);
  const entranceDuration = clampDuration(
    entranceType === "draw" ? 0.8 : 0.5,
    input.durationSec,
  );

  // Stagger per animation-principles: 40–80ms/item, group reveal capped.
  const stagger =
    targets.length > 1
      ? Math.min(
          STAGGER.capSpreadSec / (targets.length - 1),
          STAGGER.defaultSec,
        )
      : 0;
  const spread = stagger * (targets.length - 1);

  targets.forEach((target, i) => {
    const start = quantizeToBeat(
      ENTRANCE_DELAY_SEC + stagger * i,
      input.beatsPerMinute,
    );
    animations.push({
      id: `${input.sceneId}-enter-${i + 1}`,
      target,
      type: entranceType,
      start,
      duration: entranceDuration,
      easing: "easeOut",
    });
  });

  // One mid-scene emphasis keeps a focal point in longer scenes.
  if (input.durationSec >= EMPHASIS_MIN_SCENE_SEC) {
    const start = quantizeToBeat(
      input.durationSec * EMPHASIS_AT_FRACTION,
      input.beatsPerMinute,
    );
    animations.push({
      id: `${input.sceneId}-emphasis-1`,
      target: targets[0]!,
      type: "highlight",
      start: Math.min(start, input.durationSec - EMPHASIS_DURATION_SEC),
      duration: EMPHASIS_DURATION_SEC,
      easing: "easeInOut",
    });
  }

  return {
    animations,
    transition: { in: "fade", out: "fade" },
  };
}

/** Structural validation against the VDSL canonical sets and the scene
 * timeline. Returns a list of problems; empty = legal. */
export function validateMotionSpec(
  spec: MotionSpec,
  sceneDurationSec: number,
  eps = 0.05,
): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const anim of spec.animations) {
    if (ids.has(anim.id)) {
      problems.push(`duplicate animation id: ${anim.id}`);
    }
    ids.add(anim.id);
    if (!(ANIMATION_TYPES as readonly string[]).includes(anim.type)) {
      problems.push(`${anim.id}: unknown type "${anim.type}"`);
    }
    if (!(EASINGS as readonly string[]).includes(anim.easing)) {
      problems.push(`${anim.id}: unknown easing "${anim.easing}"`);
    }
    if (anim.duration <= 0) {
      problems.push(`${anim.id}: non-positive duration`);
    }
    if (anim.start < 0) {
      problems.push(`${anim.id}: negative start`);
    }
    if (anim.start + anim.duration > sceneDurationSec + eps) {
      problems.push(
        `${anim.id}: runs ${ (anim.start + anim.duration).toFixed(2) }s but scene is ${sceneDurationSec.toFixed(2)}s`,
      );
    }
  }
  return problems;
}
