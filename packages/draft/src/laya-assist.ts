import path from "node:path";
import {
  LayaClient,
  appendLayaDecision,
  resolveLayaConfig,
  stateSha256,
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
  let decision: Awaited<ReturnType<LayaClient["decide"]>>;
  try {
    decision = await client.decide(state, {
      [LAYA_VISUAL_QID]: {
        type: "choice",
        instructions:
          "Which VDSL scene component best matches this scene's visual direction? " +
          "Pick the ONE component that will visualize the content.",
        criteria: [...LAYA_VISUAL_COMPONENTS],
      },
    });
  } catch {
    // LayaClient.decide is contractually never-throwing; this is
    // defense-in-depth so a faulty client can't break the draft.
    return null;
  }
  const answer = decision?.answers[LAYA_VISUAL_QID];
  const component = answer?.value;
  if (
    decision === null ||
    answer === undefined ||
    component === undefined ||
    !(LAYA_VISUAL_COMPONENTS as readonly string[]).includes(component)
  ) {
    return null;
  }
  return {
    component: component as VisualAssistResult["component"],
    latencyMs: decision.latencyMs,
    routingModel: decision.routingModel,
    confidence: answer.confidence,
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
    const res = await askLayaVisual(client, visual, narrationExcerpt, i);
    if (opts.sidecarPath) {
      try {
        await appendLayaDecision(opts.sidecarPath, {
          ts: new Date().toISOString(),
          surface: "visual",
          mode: opts.mode,
          state_sha256: stateSha256(state),
          questions: {
            [LAYA_VISUAL_QID]: {
              type: "choice",
              instructions: "pick VDSL scene component",
              criteria: [...LAYA_VISUAL_COMPONENTS],
            },
          },
          answers: res
            ? {
                [LAYA_VISUAL_QID]: {
                  type: "choice",
                  value: res.component,
                  confidence: res.confidence ?? 0,
                  routingModel: res.routingModel ?? "unknown",
                },
              }
            : null,
          routing_model: res?.routingModel ?? null,
          latency_ms: res?.latencyMs ?? null,
          acted: opts.mode === "on" && res !== null,
          expected: DEFAULT_VISUAL_COMPONENT,
          ...(res
            ? { agreed: res.component === DEFAULT_VISUAL_COMPONENT }
            : {}),
        });
      } catch {
        // Telemetry must never break the pipeline.
      }
    }
    if (res && opts.mode === "on") {
      answered += 1;
      overrides.set(i, res.component);
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
