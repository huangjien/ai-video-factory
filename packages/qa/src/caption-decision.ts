/**
 * The caption-overlap decision seam — a `noul` predicate over the
 * bottom band.
 *
 * The caption band is the strip the timed caption is drawn into (the
 * lowest 5.5% of the frame, `packages/video-components/src/captionStyle.ts`).
 * The deterministic QA check knows where the CAPTION sits; it cannot see
 * what ELSE is drawn in that band, so a scene that prints its own title
 * there ships with two texts stacked on top of each other (the v0.9.1
 * comparison card) and no finding at all.
 *
 * This surface asks the question the check cannot: **is another piece of
 * text drawn in the bottom band at the same time as the caption?**
 *
 * What it does NOT do: it never gates. The advisory is written to the
 * decision log, the report is not rewritten, and a scene the model calls
 * an overlap still ships exactly as it would without the layer.
 */
import { createHash } from "node:crypto";
import { DECISION_QUESTIONS, loadDecisionQuestion } from "@video/prompts";
import type { RenderPlan } from "@video/vdsl";
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

/** One caption cue, as the render plan holds it. */
export interface CaptionCue {
  startSec: number;
  endSec: number;
  text: string;
}

/** The scene facts the decision sees. */
export interface CaptionOverlapScene {
  sceneId: string;
  /** 1-based position in the film. */
  sceneIndex: number;
  sceneCount: number;
  component: string;
  /** The scene's timed caption cues. */
  cues: CaptionCue[];
  /** The scene's OWN text, when it draws one. */
  ownText?: string | undefined;
  /** Where that own text sits: in the caption band, or above it. */
  ownPlacement?: "in-band" | "above-band" | undefined;
}

/**
 * The captioned frames of a rendered plan, in the shape the decision
 * reads.
 *
 * Only scenes that actually carry a caption are consulted: the band can
 * only hold two texts when one of them is the caption.
 *
 * The scene's own text comes from the CS-06 overlay (`overlay:` in the
 * storyboard) — it declares its own position, and `bottom` IS the
 * caption band. The baked PNG overlay (`props.textOverlaySrc`) is
 * written above the safe area by `scripts/pillow-text-overlay.py`, so
 * it never shares the band.
 */
export function captionOverlapScenes(plan: RenderPlan): CaptionOverlapScene[] {
  const scenes: CaptionOverlapScene[] = [];
  plan.scenes.forEach((scene, index) => {
    const cues = scene.captions?.cues ?? [];
    if (cues.length === 0) return;
    const overlay = scene.overlay ?? null;
    const overlayText =
      typeof overlay?.title === "string" && overlay.title !== ""
        ? overlay.title
        : typeof overlay?.chapter === "string" && overlay.chapter !== ""
          ? overlay.chapter
          : "";
    const bakedText =
      typeof scene.props?.["textOverlaySrc"] === "string" &&
      scene.props["textOverlaySrc"] !== ""
        ? String(scene.props["caption"] ?? "")
        : "";
    const ownText = overlayText !== "" ? overlayText : bakedText;
    const ownPlacement =
      overlayText !== ""
        ? overlay?.position === "bottom"
          ? ("in-band" as const)
          : ("above-band" as const)
        : bakedText !== ""
          ? ("above-band" as const)
          : undefined;
    scenes.push({
      sceneId: scene.id,
      sceneIndex: index + 1,
      sceneCount: plan.scenes.length,
      component: scene.component ?? "",
      cues: cues.map((cue) => ({
        startSec: cue.startSec,
        endSec: cue.endSec,
        text: cue.lines.join(" "),
      })),
      ...(ownText !== "" ? { ownText, ownPlacement } : {}),
    });
  });
  return scenes;
}

/** One caption-overlap log row. */
export interface CaptionDecisionRow {
  ts: string;
  surface: "caption-overlap";
  project: string;
  scene: string;
  mode: DecisionMode;
  provider: string;
  model: string;
  state_sha256: string;
  /** The probability that the band holds two texts — 0.5 means the
   *  model does not know. */
  answer: string | null;
  confidence: number | null;
  confidence_source: string | null;
  /** Today's deterministic path: the caption check only knows the
   *  caption, so it answers "no overlap". */
  baseline: "false";
  /** Did the decision agree with the deterministic path? */
  agreed: boolean | null;
  latency_ms: number;
  usage: { input: number; output: number };
  error: string | null;
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * The state a caption-overlap decision sees: the frame, the caption it
 * carries, and anything else drawn in the same band.
 *
 * The corpus's caption-overlap cases are built by THIS function, so a
 * harvested case and a shadow-run consult have the same shape.
 */
export function buildCaptionOverlapState(scene: CaptionOverlapScene): string {
  const lines = [
    `Frame ${scene.sceneIndex} of ${scene.sceneCount}. The bottom band of the frame carries the timed caption.`,
  ];
  if (scene.cues.length === 0) {
    lines.push("This frame has no caption cue.");
  } else {
    const first = scene.cues[0]!;
    const last = scene.cues[scene.cues.length - 1]!;
    lines.push(
      `The caption runs ${scene.cues.length} cue(s) from ${clock(first.startSec)} to ${clock(last.endSec)}: "${first.text.replace(/\s+/g, " ").trim().slice(0, 80)}"`,
    );
  }
  if (scene.ownText !== undefined && scene.ownText.trim() !== "") {
    const where =
      scene.ownPlacement === "above-band"
        ? "above the caption band"
        : "in the caption band";
    lines.push(
      `The scene also draws its own text ${where}: "${scene.ownText.replace(/\s+/g, " ").trim().slice(0, 80)}"`,
    );
  } else {
    lines.push("No other text is drawn in that region.");
  }
  return lines.join(" ");
}

/** The question the caption-overlap decision is asked. */
export function captionOverlapQuestion(sceneId: string): DecisionQuestion {
  const spec = DECISION_QUESTIONS["caption-overlap"];
  return {
    id: `caption-overlap:${sceneId}`,
    kind: "noul",
    instructions: loadDecisionQuestion("caption-overlap"),
    ...(spec.trueMeaning !== undefined
      ? { trueMeaning: spec.trueMeaning }
      : {}),
    ...(spec.falseMeaning !== undefined
      ? { falseMeaning: spec.falseMeaning }
      : {}),
    ...(spec.resultProperty ? { resultProperty: spec.resultProperty } : {}),
  };
}

/** Ask the decision model whether a frame's bottom band holds two
 *  texts, and record the answer beside the deterministic path. */
export async function consultCaptionOverlap(opts: {
  project: string;
  scene: CaptionOverlapScene;
  provider: DecisionProvider;
  mode: DecisionMode;
}): Promise<CaptionDecisionRow> {
  const state = buildCaptionOverlapState(opts.scene);
  const result = await consultDecision({
    provider: opts.provider,
    question: captionOverlapQuestion(opts.scene.sceneId),
    state,
  });
  const saysOverlap = result.answer !== null && Number(result.answer) >= 0.5;
  return {
    ts: new Date().toISOString(),
    surface: "caption-overlap",
    project: opts.project,
    scene: opts.scene.sceneId,
    mode: opts.mode,
    provider: result.provider,
    model: result.model,
    state_sha256: createHash("sha256").update(state).digest("hex"),
    answer: result.answer,
    confidence: result.confidence,
    confidence_source: result.confidenceSource,
    baseline: "false",
    agreed: result.answer === null ? null : saysOverlap === false,
    latency_ms: result.latencyMs,
    usage: result.usage,
    error: result.error,
  };
}

/**
 * The shadow pass, as the pipeline calls it: consult the decision model
 * about every captioned frame and append the answers to the project's
 * decision log.
 *
 * The consult is capped — one API call per captioned frame is a lot of
 * calls for a film with 40 scenes, and the cap keeps the first frames,
 * which are the ones a human watches first.
 */
export async function runCaptionOverlapShadow(opts: {
  project: string;
  scenes: CaptionOverlapScene[];
  mode?: DecisionMode | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  provider?: DecisionProvider | undefined;
  logPath?: string | undefined;
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
      `  decision shadow (captions) skipped: ${provider.name} key not set (${provider.name === "openai" ? "OPENAI_API_KEY" : "MINIMAX_API_KEY"})`,
    );
    return { consulted: 0, agreed: 0, mode };
  }
  const cap = Math.max(1, opts.maxConsults ?? 6);
  const rows: CaptionDecisionRow[] = [];
  for (const scene of opts.scenes.slice(0, cap)) {
    rows.push(
      await consultCaptionOverlap({
        project: opts.project,
        scene,
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
