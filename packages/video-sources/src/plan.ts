import type { ChatMessage, Provider } from "@video/llm";
import { callStructuredAgent } from "@video/llm";
import { loadPrompt } from "@video/prompts";
import { z } from "zod";
import type { SceneVideoPlan } from "./types.js";

/**
 * The per-scene plan: which scenes would a public-domain film actually
 * improve, and what to search for.
 *
 * ONE LLM call per video, same as the picture planner — a whole-article
 * judgement, allowed to fail (a failed plan means no retrieval at all and
 * the run continues exactly as before the feature existed).
 *
 * There is no `mode` in a video plan: a clip is always the scene's
 * background. The planner's only real decisions are WHICH scenes deserve
 * footage and WHAT the archive would call it.
 */

/** Body lives in `packages/prompts/prompts/video-source-plan.md`. */
const SYSTEM_PROMPT = loadPrompt("video-source-plan");

/** Bound per-film archive retrieval work. */
export const MAX_VIDEO_SCENES = 10;

export interface PlanVideoSceneInput {
  /** 1-based scene number. */
  scene: number;
  id: string;
  visual: string;
  caption?: string | undefined;
  narration?: string | undefined;
}

export interface PlanVideoInput {
  title: string;
  /** The article's declared era/region/culture, when it has one. */
  setting?: string | undefined;
  scenes: PlanVideoSceneInput[];
}

const SceneVideoPlanSchema = z.object({
  scene: z.number().int().positive(),
  historical: z.boolean(),
  subject: z.string().default(""),
  query: z.string().default(""),
  reason: z.string().default(""),
});

const PlanSchema = z.object({
  scenes: z.array(SceneVideoPlanSchema),
});

export class VideoSourcePlanError extends Error {
  override readonly cause: unknown;
  constructor(
    message: string,
    public readonly providerName: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "VideoSourcePlanError";
    this.cause = cause;
  }
}

/** The exact messages handed to the planner — extracted so the mapping is
 *  testable without a provider. */
export function buildVideoPlanMessages(input: PlanVideoInput): ChatMessage[] {
  const lines: string[] = [];
  lines.push(`Select up to ${MAX_VIDEO_SCENES} eligible footage scenes. Prefer footage wherever it directly illustrates the narration.`);
  lines.push(`Video title: ${input.title}`);
  if (input.setting !== undefined && input.setting.trim() !== "") {
    lines.push(`Setting: ${input.setting.trim()}`);
  }
  lines.push("");
  for (const scene of input.scenes) {
    lines.push(`Scene ${scene.scene} (${scene.id}): ${scene.visual}`);
    if (scene.caption !== undefined && scene.caption.trim() !== "") {
      lines.push(`  on-screen text: ${scene.caption.trim()}`);
    }
    if (scene.narration !== undefined && scene.narration.trim() !== "") {
      lines.push(`  narration: ${scene.narration.trim().slice(0, 240)}`);
    }
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n") },
  ];
}

/** Ask the planner. Throws `VideoSourcePlanError` — the caller decides
 *  whether a missing plan is fatal (it is not). */
export async function planSceneVideos(
  input: PlanVideoInput,
  provider: Provider,
): Promise<SceneVideoPlan[]> {
  const r = await callStructuredAgent({
    messages: buildVideoPlanMessages(input),
    provider,
    fallback: null,
    schema: PlanSchema,
    schemaLabel: "Video source plan schema",
    toError: (message, providerName, cause) =>
      new VideoSourcePlanError(message, providerName, cause),
  });
  return normalizeVideoPlan(r.data.scenes, input);
}

/** The LLM's plan, reconciled with the article: a scene it skipped or
 *  mismatched is planned as "no clip", a plan entry for a scene that does
 *  not exist is dropped, and eligible scenes are kept in order up to the cap. */
export function normalizeVideoPlan(
  raw: {
    scene: number;
    historical: boolean;
    subject: string;
    query: string;
    reason: string;
  }[],
  input: PlanVideoInput,
): SceneVideoPlan[] {
  const byScene = new Map<number, (typeof raw)[number]>();
  for (const entry of raw) byScene.set(entry.scene, entry);
  const out: SceneVideoPlan[] = [];
  let kept = 0;
  for (const scene of input.scenes) {
    const entry = byScene.get(scene.scene);
    if (entry === undefined || !entry.historical || entry.query.trim() === "") {
      out.push({
        scene: scene.scene,
        historical: false,
        subject: "",
        query: "",
        reason: "not planned",
      });
      continue;
    }
    if (kept >= MAX_VIDEO_SCENES) {
      out.push({
        scene: scene.scene,
        historical: false,
        subject: "",
        query: "",
        reason: "over the per-film footage cap",
      });
      continue;
    }
    kept += 1;
    out.push({
      scene: scene.scene,
      historical: true,
      subject: entry.subject.trim(),
      query: entry.query.trim(),
      reason: entry.reason.trim(),
    });
  }
  return out;
}
