/**
 * The QA triage decision seam — D3, the first ACTING surface.
 *
 * The other wired surfaces (visual-class, draft-bar) only RECORD: the
 * decision's answer lands in the log beside the baseline, and nothing
 * in the pipeline reads it. This surface is different — its action is
 * writing an advisory verdict onto each QA finding, which a human reads
 * in the report. That is still advisory in the load-bearing sense (the
 * strict gate reads `level`, never the advisory; the export path is
 * untouched), but it is a surface the pipeline's output shows, so two
 * rules are stricter here:
 *
 *  1. **The consult never touches the deterministic report.** The QA
 *     checks are ffprobe-based and replay-verified; the advisory is
 *     attached AFTER the report is written, by re-writing only the
 *     findings' advisory fields. A run without a provider key produces
 *     a byte-identical report.
 *  2. **The baseline is the check's own level.** The corpus's
 *     `qa-finding-level` rule maps error → block, warn → review — and
 *     the corpus measured the model agreeing with that mapping 7/7. The
 *     advisory's value is not out-predicting the level on today's
 *     finding types (it cannot — the labels came from the levels); it
 *     is the human-facing note plus the log rows that measure the model
 *     on every NEW finding type a future check invents.
 */
import { createHash } from "node:crypto";
import { appendFile, writeFile } from "node:fs/promises";
import { DECISION_QUESTIONS, loadDecisionQuestion } from "@video/prompts";
import {
  createDecisionProvider,
  consultDecisionMany,
  decisionLogPath,
  resolveDecisionMode,
  warnIfQuotaExhausted,
  type DecisionMode,
  type DecisionProvider,
  type DecisionQuestion,
} from "@video/llm";
import type { QaFinding, RenderReport } from "./index.js";

/** The verdict a finding's own level maps to — the `qa-finding-level`
 *  labelling rule, as code. */
export function qaFindingBaseline(
  level: QaFinding["level"],
): "pass" | "review" | "block" {
  if (level === "error") return "block";
  if (level === "warn") return "review";
  return "pass";
}

/** The state a QA finding presents, in the corpus's format. */
export function buildQaState(finding: QaFinding): string {
  const lines = [`${finding.level} · ${finding.check} · ${finding.message}`];
  if (finding.fix) lines.push(`fix: ${finding.fix}`);
  return lines.join("\n");
}

/** The question the QA advisory is asked. */
export function qaDecisionQuestion(): DecisionQuestion {
  const spec = DECISION_QUESTIONS["qa-triage"];
  return {
    id: "qa-triage",
    kind: "choice",
    instructions: loadDecisionQuestion("qa-triage"),
    ...(spec.options ? { options: spec.options } : {}),
    ...(spec.resultProperty ? { resultProperty: spec.resultProperty } : {}),
  };
}

/** One QA advisory log row. */
export interface QaDecisionRow {
  ts: string;
  surface: "qa-triage";
  project: string;
  check: string;
  level: QaFinding["level"];
  mode: DecisionMode;
  provider: string;
  model: string;
  state_sha256: string;
  answer: string | null;
  confidence: number | null;
  confidence_source: string | null;
  /** What the check's own level maps to. */
  baseline: string;
  agreed: boolean | null;
  latency_ms: number;
  usage: { input: number; output: number };
  error: string | null;
}

export interface QaAdvisoryOptions {
  project: string;
  report: RenderReport;
  mode?: DecisionMode | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  provider?: DecisionProvider | undefined;
  logPath?: string | undefined;
}

export interface QaAdvisoryResult {
  consulted: number;
  agreed: number;
  mode: DecisionMode;
  /** The report with advisory fields attached to the findings. */
  report: RenderReport;
}

/**
 * Consult the decision model about each finding and attach the
 * advisory.
 *
 * A report with no findings is not consulted: there is nothing to
 * advise on, and the clean-report case is already the check suite's
 * own `ok: true`.
 */
export async function runQaDecisionAdvisory(
  opts: QaAdvisoryOptions,
): Promise<QaAdvisoryResult> {
  const env = opts.env ?? process.env;
  const mode = opts.mode ?? resolveDecisionMode(env);
  const findings = opts.report.findings;
  if (mode === "off" || findings.length === 0) {
    return { consulted: 0, agreed: 0, mode, report: opts.report };
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
      `  decision advisory skipped: ${provider.name} key not set (${provider.name === "openai" ? "OPENAI_API_KEY" : provider.name === "google" ? "GEMINI_API_KEY" : "MINIMAX_API_KEY"})`,
    );
    return { consulted: 0, agreed: 0, mode, report: opts.report };
  }

  const question = qaDecisionQuestion();
  const request = {
    input: [
      {
        type: "text" as const,
        text: JSON.stringify(
          findings.map((finding, index) => ({
            index,
            finding: buildQaState(finding),
          })),
        ),
      },
    ],
    questions: findings.map((finding, index) => ({
      question: {
        ...question,
        id: `qa-finding-${index}`,
        instructions: `${question.instructions}\nEvaluate only finding index ${index} (check: ${finding.check}): ${buildQaState(finding)}`,
      },
    })),
  };
  const batch = await consultDecisionMany({ provider, request });
  const answerById = new Map(
    batch.answers.map((answer) => [answer.questionId, answer]),
  );
  const rows: QaDecisionRow[] = [];
  const annotated: QaFinding[] = [];
  for (const [index, finding] of findings.entries()) {
    const state = buildQaState(finding);
    const baseline = qaFindingBaseline(finding.level);
    const result = answerById.get(`qa-finding-${index}`);
    const answer =
      result?.value?.kind === "choice" ? result.value.option : null;
    const confidence = result?.confidence ?? null;
    const confidenceSource = result?.confidenceSource ?? null;
    const error = result?.error ?? batch.error ?? null;
    rows.push({
      ts: new Date().toISOString(),
      surface: "qa-triage",
      project: opts.project,
      check: finding.check,
      level: finding.level,
      mode,
      provider: batch.provider,
      model: batch.model,
      state_sha256: createHash("sha256").update(state).digest("hex"),
      answer,
      confidence,
      confidence_source: confidenceSource,
      baseline,
      agreed: answer === null ? null : answer === baseline,
      latency_ms: index === 0 ? batch.latencyMs : 0,
      usage: index === 0 ? batch.usage : { input: 0, output: 0 },
      error,
    });
    const advisoryFinding: QaFinding = { ...finding };
    if (answer === "pass" || answer === "review" || answer === "block") {
      advisoryFinding.advisory = answer;
    }
    if (confidence !== null) advisoryFinding.advisory_confidence = confidence;
    annotated.push(advisoryFinding);
  }

  warnIfQuotaExhausted(rows.map((row) => row.error));
  if (opts.logPath !== undefined && rows.length > 0) {
    try {
      const body = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
      await appendFile(opts.logPath, body, "utf8");
    } catch (err) {
      console.error(
        `  ! could not write the decision log (${opts.logPath}): ${(err as Error).message}`,
      );
    }
  }

  return {
    consulted: rows.length,
    agreed: rows.filter((row) => row.agreed === true).length,
    mode,
    report: { ...opts.report, findings: annotated },
  };
}

/** Re-write the report file with the advisory fields attached. Only
 *  called when at least one consult succeeded. */
export async function writeQaAdvisoryReport(
  reportPath: string,
  report: RenderReport,
): Promise<void> {
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
}

/** The decision log path for a project — re-exported from @video/llm
 *  for callers that already import QA helpers from here. */
export { decisionLogPath };
