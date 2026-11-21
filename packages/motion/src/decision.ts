/**
 * The motion pre-screen decision seam — surface D1.
 *
 * The pipeline plans motion twice for every scene: once with the
 * deterministic heuristics (`planSceneMotion`) and once with the cloud
 * motion agent, which edits the baseline. The agent call is the
 * costliest per-scene call in the make pipeline, and the shipped
 * artifacts say the baseline is rarely the plan that shipped: in the
 * 528 shipped scenes that carry a motion plan, 482 animate a NAMED
 * element (`event-1979`, `__title__`, `line-0`) — something the
 * component-family heuristics cannot know.
 *
 * So the question this surface asks is narrow and answerable: **does
 * this scene's baseline plan already say what the scene is about, or
 * would a second pass change what the viewer sees?**
 *
 * What it does NOT do: it never skips the agent call. The seam runs in
 * `shadow` — the decision is consulted and logged beside the baseline,
 * and the agent still runs. The corpus has to measure the surface
 * before any answer is allowed to change a plan (v0.11 §10).
 */
import { createHash } from "node:crypto";
import { DECISION_QUESTIONS, loadDecisionQuestion } from "@video/prompts";
import {
  appendDecisionRows,
  consultDecision,
  createDecisionProvider,
  resolveDecisionMode,
  warnIfQuotaExhausted,
  type DecisionMode,
  type DecisionProvider,
  type DecisionQuestion,
} from "@video/llm";
import type { MotionSpec } from "./plan.js";

/** The scene facts the decision sees. */
export interface MotionPrescreenScene {
  sceneId: string;
  durationSec: number;
  /** The VDSL component the scene renders. */
  component: string;
  /** The scene's narration — the content the plan has to match. */
  narrationText?: string | undefined;
  /** The scene's visual props, already serialized by the caller. */
  propsSummary?: string | undefined;
}

/** One motion pre-screen log row. */
export interface MotionDecisionRow {
  ts: string;
  surface: "motion-prescreen";
  project: string;
  scene: string;
  mode: DecisionMode;
  provider: string;
  model: string;
  state_sha256: string;
  answer: string | null;
  confidence: number | null;
  confidence_source: string | null;
  /** What today's deterministic path answers: the baseline plan is what
   *  runs when nobody refines it, so the deterministic answer is
   *  `keep`. */
  baseline: "keep";
  /** Did the decision agree with the deterministic path? */
  agreed: boolean | null;
  latency_ms: number;
  usage: { input: number; output: number };
  error: string | null;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** The baseline plan, as the decision reads it. */
export function describeMotionPlan(spec: MotionSpec): string {
  if (spec.animations.length === 0) {
    return "no animation — the scene is held still";
  }
  return spec.animations
    .map(
      (a) =>
        `${a.type} on "${a.target}" at ${a.start.toFixed(2)}s for ${a.duration.toFixed(2)}s (${a.easing})`,
    )
    .join("; ");
}

/**
 * The state a motion pre-screen decision sees: the scene (its content
 * and its facts) and the plan the pipeline would use without a second
 * pass.
 *
 * The corpus's motion-prescreen cases are built by THIS function, so a
 * case harvested from a shadow run has exactly the shape the bench
 * already measures — no second format, no drift.
 */
export function buildMotionPrescreenState(
  scene: MotionPrescreenScene,
  baseline: MotionSpec,
): string {
  const lines = [
    `Scene ${scene.sceneId} — ${scene.durationSec.toFixed(2)}s, component ${scene.component}.`,
  ];
  if (scene.narrationText !== undefined && scene.narrationText.trim() !== "") {
    lines.push(`Narration: ${clip(scene.narrationText, 400)}`);
  }
  if (scene.propsSummary !== undefined && scene.propsSummary.trim() !== "") {
    lines.push(`Scene elements: ${clip(scene.propsSummary, 400)}`);
  }
  lines.push(
    "",
    `The plan without a second pass: ${describeMotionPlan(baseline)}.`,
  );
  return lines.join("\n");
}

/** The question the motion pre-screen is asked. */
export function motionPrescreenQuestion(sceneId: string): DecisionQuestion {
  const spec = DECISION_QUESTIONS["motion-prescreen"];
  return {
    id: `motion-prescreen:${sceneId}`,
    kind: "choice",
    instructions: loadDecisionQuestion("motion-prescreen"),
    ...(spec.options ? { options: spec.options } : {}),
    ...(spec.resultProperty ? { resultProperty: spec.resultProperty } : {}),
  };
}

/**
 * Ask the decision model whether a scene's baseline plan is worth a
 * second pass, and record the answer beside the deterministic baseline.
 */
export async function consultMotionPrescreen(opts: {
  project: string;
  scene: MotionPrescreenScene;
  baseline: MotionSpec;
  provider: DecisionProvider;
  mode: DecisionMode;
}): Promise<MotionDecisionRow> {
  const state = buildMotionPrescreenState(opts.scene, opts.baseline);
  const result = await consultDecision({
    provider: opts.provider,
    question: motionPrescreenQuestion(opts.scene.sceneId),
    state,
  });
  return {
    ts: new Date().toISOString(),
    surface: "motion-prescreen",
    project: opts.project,
    scene: opts.scene.sceneId,
    mode: opts.mode,
    provider: result.provider,
    model: result.model,
    state_sha256: createHash("sha256").update(state).digest("hex"),
    answer: result.answer,
    confidence: result.confidence,
    confidence_source: result.confidenceSource,
    baseline: "keep",
    agreed: result.answer === null ? null : result.answer === "keep",
    latency_ms: result.latencyMs,
    usage: result.usage,
    error: result.error,
  };
}

/**
 * The shadow pass, as the pipeline calls it: consult the decision model
 * about every scene's baseline plan and append the answers to the
 * project's decision log.
 *
 * The consult happens BEFORE the agent call, so the log row and the
 * plan it was made about describe the same baseline. Nothing about the
 * agent's behaviour changes.
 */
export async function runMotionPrescreenShadow(opts: {
  project: string;
  scenes: { scene: MotionPrescreenScene; baseline: MotionSpec }[];
  mode?: DecisionMode | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  provider?: DecisionProvider | undefined;
  logPath?: string | undefined;
  /** Cap on the consults in one run — every consult is a real API call.
   *  The default keeps the first scenes of the film, which are the ones
   *  a human looks at first. */
  maxConsults?: number | undefined;
}): Promise<{ consulted: number; agreed: number; mode: DecisionMode }> {
  const env = opts.env ?? process.env;
  const mode = opts.mode ?? resolveDecisionMode(env);
  if (mode === "off" || opts.scenes.length === 0) {
    return { consulted: 0, agreed: 0, mode };
  }
  const provider =
    opts.provider ??
    createDecisionProvider({
      ...(env["DECISION_PROVIDER"] !== undefined
        ? { provider: env["DECISION_PROVIDER"] }
        : {}),
      ...(env["DECISION_MODEL"] !== undefined
        ? { model: env["DECISION_MODEL"] }
        : {}),
    });
  if (!provider.available()) {
    console.error(
      `  decision shadow (motion) skipped: ${provider.name} key not set (${provider.name === "openai" ? "OPENAI_API_KEY" : provider.name === "google" ? "GEMINI_API_KEY" : "MINIMAX_API_KEY"})`,
    );
    return { consulted: 0, agreed: 0, mode };
  }
  const cap = Math.max(1, opts.maxConsults ?? 6);
  const rows: MotionDecisionRow[] = [];
  for (const entry of opts.scenes.slice(0, cap)) {
    rows.push(
      await consultMotionPrescreen({
        project: opts.project,
        scene: entry.scene,
        baseline: entry.baseline,
        provider,
        mode: "shadow",
      }),
    );
  }
  warnIfQuotaExhausted(rows.map((row) => row.error));
  if (opts.logPath !== undefined) {
    await appendDecisionRows(opts.logPath, rows);
  }
  return {
    consulted: rows.length,
    agreed: rows.filter((row) => row.agreed === true).length,
    mode,
  };
}
