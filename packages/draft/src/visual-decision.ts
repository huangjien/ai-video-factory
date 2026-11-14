/**
 * The visual decision seam — D2, in shadow.
 *
 * The keyword classifier routes a scene by regex and falls through to
 * `AnimatedIllustration` when nothing matches. The fall-through is
 * where a decision model earns its keep: it can read a STRUCTURE the
 * regex cannot see ("three arrows joined head to tail in a ring").
 *
 * This module runs that question BESIDE the classifier and records the
 * answer next to the classifier's own. In `shadow` mode nothing changes:
 * the storyboard is exactly what it was. The log is the point — it is
 * how the corpus grows from production instead of from hand labels.
 *
 * Rules that make it safe to run inside a draft:
 *
 *  1. **It never breaks the pipeline.** A provider that is down, a
 *     timeout, a malformed answer, a log that cannot be written — none
 *     of them may fail a draft.
 *  2. **It never sees more than the classifier saw.** The state is the
 *     scene's visual line, so the decision and the classifier are
 *     answering the same question.
 *  3. **The raw state is never written.** The log carries a hash of it,
 *     so a scene description that contains project-confidential text
 *     stays out of the log.
 */
import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";
import {
  DECISION_QUESTIONS,
  loadDecisionQuestion,
} from "@video/prompts";
import {
  MiniMaxDecisionProvider,
  OpenAIDecisionProvider,
  type DecisionProvider,
  type DecisionQuestion,
} from "@video/llm";
import {
  DEFAULT_VISUAL_COMPONENT,
  pickVisualComponent,
} from "./visual-classifier.js";
import { candidateId, type DecisionCandidate } from "./decision-candidate.js";

export type DecisionMode = "off" | "shadow" | "on";

/** The mode from the environment. Default `off` — the pipeline behaves
 *  exactly as it does today until somebody asks for the shadow pass. */
export function resolveDecisionMode(
  env: NodeJS.ProcessEnv = process.env,
): DecisionMode {
  const raw = (env["DECISION_MODE"] ?? "off").trim().toLowerCase();
  if (raw === "off" || raw === "shadow" || raw === "on") return raw;
  throw new Error(
    `unknown DECISION_MODE "${raw}" — expected off | shadow | on`,
  );
}

/** The provider the shadow pass asks. Default: the OpenAI Decisions
 *  API (the bench's faster and more accurate of the two). */
export function createDecisionProvider(
  opts: { provider?: string | undefined; model?: string | undefined } = {},
): DecisionProvider {
  const name = (opts.provider ?? "openai").trim().toLowerCase();
  if (name === "openai") {
    return new OpenAIDecisionProvider(
      opts.model !== undefined ? { model: opts.model } : {},
    );
  }
  if (name === "minimax") {
    return new MiniMaxDecisionProvider(
      opts.model !== undefined ? { model: opts.model } : {},
    );
  }
  throw new Error(`unknown decision provider "${name}" — openai | minimax`);
}

/** One scene, as the decision sees it. */
export interface VisualDecisionScene {
  id: string;
  /** The scene's description — exactly what the classifier reads. */
  visual?: string | undefined;
  /** An explicit `component:` in the article, when the human set one.
   *  A scene the human routed is never consulted. */
  component?: string | undefined;
}

export interface VisualDecisionRow {
  ts: string;
  surface: "visual-class";
  /** The scene the consult was about. */
  scene_id: string;
  mode: DecisionMode;
  provider: string;
  model: string;
  /** sha256 of the state. The raw state is never written. */
  state_sha256: string;
  /** The decision's answer, or null when there was none. */
  answer: string | null;
  confidence: number | null;
  confidence_source: string | null;
  /** What the keyword classifier answered. */
  baseline: string;
  /** Did the decision agree with the classifier? null when there was no
   *  answer to compare. */
  agreed: boolean | null;
  latency_ms: number;
  usage: { input: number; output: number };
  error: string | null;
}

export interface ConsultOptions {
  scenes: VisualDecisionScene[];
  provider: DecisionProvider;
  mode: DecisionMode;
  /** Where the rows are appended. Undefined = collect them, write none. */
  logPath?: string | undefined;
}

/** The question the decision is asked — the registry's wording and the
 *  surface's option list, so the bench and the pipeline ask the same
 *  thing. */
export function visualDecisionQuestion(sceneId: string): DecisionQuestion {
  const spec = DECISION_QUESTIONS["visual-class"];
  return {
    id: `visual-class:${sceneId}`,
    kind: "choice",
    instructions: loadDecisionQuestion("visual-class"),
    ...(spec.options ? { options: spec.options } : {}),
    ...(spec.resultProperty ? { resultProperty: spec.resultProperty } : {}),
  };
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Ask the decision layer about the scenes the keyword classifier could
 * not route, and record what it said.
 *
 * Only the fall-through scenes are consulted: a scene the keyword rules
 * matched is a scene the pipeline already routes correctly, and asking
 * about it would cost a call per scene for no information.
 */
export async function consultVisualDecisions(
  opts: ConsultOptions,
): Promise<VisualDecisionRow[]> {
  if (opts.mode === "off") return [];
  const rows: VisualDecisionRow[] = [];
  for (const scene of opts.scenes) {
    // A human-set component is the answer; never second-guess it.
    if (typeof scene.component === "string" && scene.component !== "") {
      continue;
    }
    const state = scene.visual ?? "";
    if (state.trim() === "") continue;
    const baseline = pickVisualComponent(state, false).component;
    if (baseline !== DEFAULT_VISUAL_COMPONENT) continue;

    const started = Date.now();
    let answer: string | null = null;
    let confidence: number | null = null;
    let confidenceSource: string | null = null;
    let usage = { input: 0, output: 0 };
    let model = "";
    let error: string | null = null;
    try {
      const result = await opts.provider.decide({
        state,
        question: visualDecisionQuestion(scene.id),
      });
      if (result === null) {
        error = opts.provider.lastError?.message ?? "no answer";
      } else {
        answer =
          result.value.kind === "choice" ? result.value.option : null;
        confidence = result.confidence;
        confidenceSource = result.confidenceSource;
        usage = result.usage;
        model = result.model;
      }
    } catch (err) {
      // A decision layer that can fail a draft is worse than none.
      error = (err as Error).message;
    }
    rows.push({
      ts: new Date().toISOString(),
      surface: "visual-class",
      scene_id: scene.id,
      mode: opts.mode,
      provider: opts.provider.name,
      model,
      state_sha256: sha256(state),
      answer,
      confidence,
      confidence_source: confidenceSource,
      baseline,
      agreed: answer === null ? null : answer === baseline,
      latency_ms: Date.now() - started,
      usage,
      error,
    });
  }
  if (opts.logPath !== undefined && rows.length > 0) {
    await appendDecisionLog(opts.logPath, rows);
  }
  return rows;
}

/** Append the rows to the project's decision log. A write failure is
 *  reported, never thrown — the log is an audit trail, not a gate. */
export async function appendDecisionLog(
  logPath: string,
  rows: VisualDecisionRow[],
): Promise<void> {
  try {
    const body = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
    await appendFile(logPath, body, "utf8");
  } catch (err) {
    console.error(
      `  ! could not write the decision log (${logPath}): ${(err as Error).message}`,
    );
  }
}

/** Where a project's decision log lives. */
export function decisionLogPath(projectRoot: string): string {
  return `${projectRoot}/decision-log.jsonl`;
}

/**
 * The shadow pass, as the pipeline calls it: resolve the mode, ask the
 * provider, append the log, and report how many scenes were consulted.
 *
 * `on` is handled as `shadow` here — the caller warns first (the gate
 * has not been cleared), and nothing in this module can act on an
 * answer anyway.
 */
export async function runVisualDecisionShadow(opts: {
  scenes: VisualDecisionScene[];
  projectRoot: string;
  mode?: DecisionMode | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  provider?: DecisionProvider | undefined;
}): Promise<{ consulted: number; agreed: number; mode: DecisionMode }> {
  const env = opts.env ?? process.env;
  const mode = opts.mode ?? resolveDecisionMode(env);
  if (mode === "off") return { consulted: 0, agreed: 0, mode };
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
  const rows = await consultVisualDecisions({
    scenes: opts.scenes,
    provider,
    mode: "shadow",
    logPath: decisionLogPath(opts.projectRoot),
  });
  return {
    consulted: rows.length,
    agreed: rows.filter((row) => row.agreed === true).length,
    mode,
  };
}


export interface HarvestOptions {
  /** The log rows — from `<project>/decision-log.jsonl`. */
  rows: VisualDecisionRow[];
  /** The project's scenes, so the state can be recovered. */
  scenes: VisualDecisionScene[];
  /** The project directory name, for the provenance and the id. */
  project: string;
}

/**
 * Turn the shadow log's DISAGREEMENTS into corpus candidates.
 *
 * A disagreement is the only thing worth a corpus case: the classifier
 * and the decision model read the same scene differently, and one of
 * them is wrong. The candidate carries the real state (recovered from
 * the article — the log keeps only a hash), the decision's answer as a
 * PROPOSED label, and the classifier's answer as the baseline.
 *
 * Every candidate is marked disputed, because a proposal is not a label:
 * a human has to rule on which answer is right before the case counts.
 */
export function harvestDecisionCandidates(
  opts: HarvestOptions,
): DecisionCandidate[] {
  const byHash = new Map<string, VisualDecisionScene>();
  const byId = new Map<string, VisualDecisionScene>();
  for (const scene of opts.scenes) {
    byId.set(scene.id, scene);
    byHash.set(sha256(scene.visual ?? ""), scene);
  }
  // The slug keeps letters and digits of ANY script — a CJK project name
  // must not collapse to an empty string, or every Chinese project would
  // claim the same case id.
  const slug = opts.project
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const candidates: DecisionCandidate[] = [];
  for (const row of opts.rows) {
    const scene =
      (row.scene_id !== undefined ? byId.get(row.scene_id) : undefined) ??
      byHash.get(row.state_sha256);
    if (!scene) continue;
    const state = scene.visual ?? "";
    if (state.trim() === "") continue;
    const answer = row.answer;
    if (answer === null) continue;
    const agreed = row.agreed === true;
    candidates.push({
      id: candidateId(slug, scene.id),
      surface: "visual-class",
      state,
      expects: { kind: "choice", value: answer },
      baseline: row.baseline,
      disputed: true,
      dispute: [
        `Proposed by the ${row.provider} decision model (${row.model}) at confidence ${row.confidence ?? "?"}`,
        `in the shadow run of ${row.ts}; the keyword classifier answered "${row.baseline}"`,
        `(${agreed ? "the two agreed" : "the two DISAGREED"}).`,
        "A human must rule on which answer is right before this becomes a corpus case.",
      ].join(" "),
      policy: {
        rule: "structure-over-photo",
        note: "Proposed rule: the decision read a structure the keyword classifier could not see. Confirm the rule with the label.",
      },
      provenance: {
        source: `projects/${opts.project}/article.md ${scene.id} — a shadow-run consult (${row.ts}); the decision model answered "${answer}", the keyword classifier "${row.baseline}".`,
      },
    });
  }
  return candidates;
}
