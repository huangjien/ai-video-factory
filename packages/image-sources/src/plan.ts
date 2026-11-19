import type { ChatMessage, Provider } from "@video/llm";
import { callStructuredAgent } from "@video/llm";
import { loadPrompt } from "@video/prompts";
import { z } from "zod";
import type { SceneSourcePlan, SourceMode } from "./types.js";

/**
 * The per-scene plan: which scenes are about a real historical subject,
 * what to look for, and how to use what comes back.
 *
 * ONE LLM call per video, not one per scene — the plan is a whole-article
 * judgement (a scene's subject often needs the previous scene's context),
 * and a single call keeps the cost at one request per film.
 *
 * The call is allowed to fail. A failed plan means no retrieval at all and
 * the run continues exactly as it did before this feature existed.
 */

/** Body lives in `packages/prompts/prompts/image-source-plan.md`. */
const SYSTEM_PROMPT = loadPrompt("image-source-plan");

export interface PlanSceneInput {
  /** 1-based scene number. */
  scene: number;
  id: string;
  visual: string;
  caption?: string | undefined;
  narration?: string | undefined;
}

export interface PlanInput {
  title: string;
  /** The article's declared era/region/culture, when it has one. */
  setting?: string | undefined;
  scenes: PlanSceneInput[];
}

const ScenePlanSchema = z.object({
  scene: z.number().int().positive(),
  historical: z.boolean(),
  subject: z.string().default(""),
  query: z.string().default(""),
  mode: z.enum(["direct", "reference", "none"]),
  reason: z.string().default(""),
});

const PlanSchema = z.object({
  scenes: z.array(ScenePlanSchema),
});

export class ImageSourcePlanError extends Error {
  override readonly cause: unknown;
  constructor(
    message: string,
    public readonly providerName: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "ImageSourcePlanError";
    this.cause = cause;
  }
}

/** The exact messages handed to the planner — extracted so the mapping is
 *  testable without a provider. */
export function buildPlanMessages(input: PlanInput): ChatMessage[] {
  const lines: string[] = [];
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

/** Ask the planner. Throws `ImageSourcePlanError` — the caller decides
 *  whether a missing plan is fatal (it is not). */
export async function planSceneSources(
  input: PlanInput,
  provider: Provider,
  fallback?: Provider | null,
): Promise<SceneSourcePlan[]> {
  const r = await callStructuredAgent({
    messages: buildPlanMessages(input),
    provider,
    fallback: fallback ?? null,
    schema: PlanSchema,
    schemaLabel: "Image source plan schema",
    toError: (message, providerName, cause) =>
      new ImageSourcePlanError(message, providerName, cause),
  });
  return normalizePlan(r.data.scenes, input);
}

/** The LLM's plan, reconciled with the article: a scene it skipped or
 *  mismatched is planned as "no picture", and a plan entry for a scene that
 *  does not exist is dropped. */
export function normalizePlan(
  raw: {
    scene: number;
    historical: boolean;
    subject: string;
    query: string;
    mode: SourceMode;
    reason: string;
  }[],
  input: PlanInput,
): SceneSourcePlan[] {
  const out: SceneSourcePlan[] = [];
  for (const scene of input.scenes) {
    const entry = raw.find((r) => r.scene === scene.scene);
    if (entry === undefined) {
      out.push({
        scene: scene.scene,
        historical: false,
        subject: "",
        query: "",
        mode: "none",
        reason: "not planned",
      });
      continue;
    }
    const historical = entry.historical && entry.query.trim() !== "";
    out.push({
      scene: scene.scene,
      historical,
      subject: entry.subject.trim(),
      query: historical ? entry.query.trim() : "",
      mode: historical ? entry.mode : "none",
      reason: entry.reason.trim(),
    });
  }
  return out;
}
