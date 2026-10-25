import path from "node:path";
import { loadPrompt } from "@video/prompts";
import {
  LayaClient,
  recordDecision,
  resolveLayaConfig,
  type LayaMode,
} from "@video/llm";
import type { ParsedArticle } from "./schemas.js";
import {
  DEFAULT_VISUAL_COMPONENT,
  LAYA_VISUAL_COMPONENTS,
  pickVisualComponent,
  type VisualAssistResult,
} from "./visual-classifier.js";

/**
 * v0.6 plan D2 — Laya assist for the visual classifier's fall-through.
 *
 * `pickVisualComponent` stays pure regex. This module consults the Laya
 * sidecar ONLY for scenes where no rule matched (the classifier would
 * emit `AnimatedIllustration`), and hands the result to
 * `articleToStoryboardYaml(article, { visualOverrides })` as a plain
 * map — the storyboard mapper itself never does I/O.
 *
 * Behavior by mode (v0.6 plan §1):
 *  - shadow: Laya is asked, rows land in `laya-decisions.jsonl`, the
 *    returned map is EMPTY — nothing changes downstream.
 *  - on: rows are recorded with acted=true and the overrides are real.
 *  - any failure: no row content beyond the null decision, no override.
 */

const NARRATION_EXCERPT_CHARS = 300;

/** Question id used in the systemone payload and the sidecar rows. */
export const LAYA_VISUAL_QID = "component";

/** Loaded at import time so the registry coverage test sees it. */
const LAYA_VISUAL_INSTRUCTIONS = loadPrompt("draft-laya-visual");

export function buildVisualAssistState(
  visual: string,
  narrationExcerpt: string,
  sceneIndex: number,
): string {
  return [
    `scene index: ${sceneIndex}`,
    `visual direction: ${visual.slice(0, 800)}`,
    `narration excerpt: ${narrationExcerpt}`,
  ].join("\n");
}

/** One Laya consult for one fall-through scene. Null = no usable answer. */
export async function askLayaVisual(
  client: LayaClient,
  visual: string,
  narrationExcerpt: string,
  sceneIndex: number,
): Promise<VisualAssistResult | null> {
  const state = buildVisualAssistState(visual, narrationExcerpt, sceneIndex);
  const res = await recordDecision(client, {
    surface: "visual",
    state,
    question: {
      id: LAYA_VISUAL_QID,
      type: "choice",
      instructions: LAYA_VISUAL_INSTRUCTIONS,
      criteria: [...LAYA_VISUAL_COMPONENTS],
    },
    // No sidecar path here: the caller records the row, because the
    // baseline (the deterministic component) is only known there.
    mode: "shadow",
    baseline: null,
  });
  if (res.choice === null) return null;
  return {
    component: res.choice as VisualAssistResult["component"],
    latencyMs: 0,
    routingModel: res.answer?.routingModel ?? "unknown",
    confidence: res.answer?.confidence ?? 0,
  };
}

export interface VisualOverridesResult {
  /** scene index (0-based, article order) → component to emit. */
  overrides: Map<number, string>;
  /** Answer counts for the CLI summary line. */
  asked: number;
  answered: number;
}

/** Consult Laya for every fall-through scene of the article. Never
 * throws; on any error the result is simply fewer overrides. */
export async function resolveVisualOverrides(
  article: ParsedArticle,
  client: LayaClient,
  opts: { mode: LayaMode; sidecarPath?: string },
): Promise<VisualOverridesResult> {
  const overrides = new Map<number, string>();
  let asked = 0;
  let answered = 0;

  for (let i = 0; i < article.scenes.length; i++) {
    const scene = article.scenes[i]!;
    const visual = scene.visual ?? "";
    if (i === 0 || visual.trim() === "") continue;
    const baseline = pickVisualComponent(visual, i === 0);
    if (baseline.component !== DEFAULT_VISUAL_COMPONENT) continue; // rule matched

    asked += 1;
    const narrationExcerpt = (scene.narration ?? "").slice(
      0,
      NARRATION_EXCERPT_CHARS,
    );
    const state = buildVisualAssistState(visual, narrationExcerpt, i);
    // ONE consult, one recorded row. The shared seam owns the consult,
    // the answer validation, the row, and the expected/agreed pair — so
    // this surface cannot forget the shadow-safety rules.
    const res = await recordDecision(client, {
      surface: "visual",
      state,
      question: {
        id: LAYA_VISUAL_QID,
        type: "choice",
        instructions: LAYA_VISUAL_INSTRUCTIONS,
        criteria: [...LAYA_VISUAL_COMPONENTS],
      },
      mode: opts.mode,
      // The deterministic classifier's fall-through IS the baseline: it
      // is what today's path would have produced for this scene.
      baseline: DEFAULT_VISUAL_COMPONENT,
      ...(opts.sidecarPath !== undefined
        ? { sidecarPath: opts.sidecarPath }
        : {}),
    });
    if (res.choice !== null && opts.mode === "on") {
      answered += 1;
      overrides.set(i, res.choice);
    }
  }
  return { overrides, asked, answered };
}

export interface LayaVisualAssistOutcome {
  /** Pass to articleToStoryboardYaml({visualOverrides}) — undefined when
   * mode is off/shadow or nothing was answered (no behavior change). */
  overrides: ReadonlyMap<number, string> | undefined;
  /** One-line CLI summary; null when laya is off. */
  summary: string | null;
}

/** CLI-facing entry (draft-command + make): consults Laya when the mode
 * is not off, appends the sidecar rows, returns overrides + summary.
 * Never throws. */
export async function runLayaVisualAssist(
  article: ParsedArticle,
  projectRoot: string,
): Promise<LayaVisualAssistOutcome> {
  const cfg = resolveLayaConfig();
  if (cfg.mode === "off") return { overrides: undefined, summary: null };
  const client = new LayaClient({ resolvedConfig: cfg });
  const res = await resolveVisualOverrides(article, client, {
    mode: cfg.mode,
    sidecarPath: path.join(projectRoot, "laya-decisions.jsonl"),
  });
  if (cfg.mode === "shadow") {
    return {
      overrides: undefined,
      summary: `laya visual: shadow — ${res.answered}/${res.asked} fall-through scene(s) answered (logged only)`,
    };
  }
  return {
    overrides: res.answered > 0 ? res.overrides : undefined,
    summary:
      res.answered > 0
        ? `laya visual: chose components for ${res.answered}/${res.asked} fall-through scene(s)`
        : null,
  };
}
