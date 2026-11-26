/**
 * The draft-bar decision seam — the surface where a decision model can
 * actually disagree with today's system.
 *
 * The draft surface is the one where the decision model can disagree
 * with today's system: it answers `reject` or `revise` where the
 * shipped review's own verdict says `revise` or `pass`. Those are real
 * disagreements, and they are the ones worth looking at.
 *
 * The state is the same compact shape the corpus uses: the review's
 * findings and verdict, which is what a decision model would have to
 * reason about. The label is **derived** from the review's own verdict
 * (the `review-verdict` rule), so a harvested disagreement becomes a
 * corpus case without anybody labelling it by hand.
 *
 * What this does NOT do (yet): screen the draft BEFORE the judge runs.
 * That is the cost-saving version, and it needs a different state —
 * the draft itself, with no findings yet. It is a separate milestone,
 * and it only makes sense once this one shows the decision model can
 * predict the verdict at all.
 */
import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";
import {
  DECISION_QUESTIONS,
  loadDecisionQuestion,
  verdictToLabel,
  type DecisionSourceVerdict,
} from "@video/prompts";
import type { DecisionProvider, DecisionQuestion } from "@video/llm";
import {
  createDecisionProvider,
  warnIfQuotaExhausted,
  type DecisionMode,
} from "@video/llm";

/** The parts of a review attempt the state and the verdict need. This
 *  is the shape the `article-review.yaml` file holds, so the corpus
 *  builder, the shadow pass and the harvest all read the same thing. */
export interface DraftBarAttemptFacts {
  attempt: number;
  overall?: number | undefined;
  grade?: string | undefined;
  passing: boolean;
  findings?:
    | {
        id?: string | undefined;
        code?: string | undefined;
        severity?: string | undefined;
        description?: string | undefined;
      }[]
    | undefined;
  risk_flags?:
    { code?: string | undefined; severity?: string | undefined }[] | undefined;
}

/** A draft-bar log row. */
export interface DraftDecisionRow {
  ts: string;
  surface: "draft-bar";
  /** The project the draft belongs to. */
  project: string;
  /** Which attempt of the draft loop this is. */
  attempt: number;
  mode: "off" | "shadow" | "on";
  provider: string;
  model: string;
  state_sha256: string;
  answer: string | null;
  confidence: number | null;
  confidence_source: string | null;
  /** The review's own verdict facts, as the corpus records them. */
  verdict: DecisionSourceVerdict & { passing: boolean };
  /** The label the verdict rule derives. */
  label: string;
  /** Did the decision agree with the review's verdict? */
  agreed: boolean | null;
  latency_ms: number;
  usage: { input: number; output: number };
  error: string | null;
}

/** The verdict facts a review attempt carries. */
export function verdictFactsFromAttempt(
  attempt: DraftBarAttemptFacts,
): DecisionSourceVerdict & { passing: boolean } {
  const critical =
    (attempt.findings ?? []).some(
      (f) => (f.severity ?? "").toLowerCase() === "critical",
    ) ||
    (attempt.risk_flags ?? []).some(
      (f) => (f.code ?? "") === "CRITICAL_BLOCKER",
    );
  const majorRevisionNeeded = (attempt.risk_flags ?? []).some(
    (f) => (f.code ?? "") === "MAJOR_REVISION_NEEDED",
  );
  return {
    passing: attempt.passing,
    ...(critical ? { critical: true } : {}),
    ...(majorRevisionNeeded ? { major_revision_needed: true } : {}),
  };
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * The state a draft-bar decision sees: the review's findings and the
 * verdict, in one compact block.
 *
 * The corpus's draft-bar cases are built by THIS function, so a case
 * harvested from a shadow run has exactly the shape the bench already
 * measures — no second format, no drift.
 */
export function buildDraftBarState(
  project: string,
  attempt: DraftBarAttemptFacts,
): string {
  const lines: string[] = [`A draft about ${project}.`];
  const findings = attempt.findings ?? [];
  if (findings.length === 0) {
    lines.push("", "No findings.");
  } else {
    for (const finding of findings) {
      const id = finding.id ?? "F-001";
      const severity = finding.severity ?? "finding";
      const code = finding.code ? `, ${finding.code}` : "";
      const description = finding.description
        ? ` ${clip(finding.description, 220)}`
        : "";
      lines.push(`${id} (${severity}${code}):${description}`);
    }
  }
  const overall = attempt.overall ?? "n/a";
  const grade = attempt.grade ?? "n/a";
  lines.push(
    "",
    `Overall ${overall}, grade ${grade}, passing ${attempt.passing}.`,
  );
  const flags = (attempt.risk_flags ?? []).map(
    (f) => `${f.code ?? "flag"} (${f.severity ?? "?"})`,
  );
  if (flags.length > 0) lines.push(`Risk flags: ${flags.join(", ")}.`);
  return lines.join("\n");
}

/** The question the draft-bar decision is asked. */
export function draftBarDecisionQuestion(attempt: number): DecisionQuestion {
  const spec = DECISION_QUESTIONS["draft-bar"];
  return {
    id: `draft-bar:attempt-${attempt}`,
    kind: "choice",
    instructions: loadDecisionQuestion("draft-bar"),
    ...(spec.options ? { options: spec.options } : {}),
    ...(spec.resultProperty ? { resultProperty: spec.resultProperty } : {}),
  };
}

/** Ask the decision layer what it thinks of one reviewed draft, and
 *  record its answer beside the review's verdict. */
export async function consultDraftDecision(opts: {
  project: string;
  attempt: DraftBarAttemptFacts;
  provider: DecisionProvider;
  mode: "off" | "shadow" | "on";
}): Promise<DraftDecisionRow> {
  const verdict = verdictFactsFromAttempt(opts.attempt);
  const label = verdictToLabel(verdict);
  const state = buildDraftBarState(opts.project, opts.attempt);
  const started = Date.now();
  let answer: string | null = null;
  let confidence: number | null = null;
  let confidenceSource: string | null = null;
  let model = "";
  // The SERVING provider — a fallback chain answers with the provider
  // that actually served the call, so a fallback run is visible in the
  // corpus instead of averaged into the primary's score.
  let servingProvider = opts.provider.name;
  let usage = { input: 0, output: 0 };
  let error: string | null = null;
  try {
    const result = await opts.provider.decide({
      state,
      question: draftBarDecisionQuestion(opts.attempt.attempt),
    });
    if (result === null) {
      error = opts.provider.lastError?.message ?? "no answer";
    } else {
      answer = result.value.kind === "choice" ? result.value.option : null;
      confidence = result.confidence;
      confidenceSource = result.confidenceSource;
      model = result.model;
      usage = result.usage;
    }
  } catch (err) {
    error = (err as Error).message;
  }
  return {
    ts: new Date().toISOString(),
    surface: "draft-bar",
    project: opts.project,
    attempt: opts.attempt.attempt,
    mode: opts.mode,
    provider: servingProvider,
    model,
    state_sha256: sha256Text(state),
    answer,
    confidence,
    confidence_source: confidenceSource,
    verdict,
    label,
    agreed: answer === null ? null : answer === label,
    latency_ms: Date.now() - started,
    usage,
    error,
  };
}

/** The sha256 of a state — the log keeps the hash, never the state. */
export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function runDraftDecisionShadow(opts: {
  project: string;
  attempts: DraftBarAttemptFacts[];
  mode?: DecisionMode | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  provider?: DecisionProvider | undefined;
  logPath?: string | undefined;
  maxConsults?: number | undefined;
}): Promise<{ consulted: number; agreed: number; mode: DecisionMode }> {
  const env = opts.env ?? process.env;
  const mode = opts.mode ?? "off";
  if (mode === "off" || opts.attempts.length === 0) {
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
      `  decision shadow (draft) skipped: ${provider.name} key not set (${provider.name === "openai" ? "OPENAI_API_KEY" : provider.name === "google" ? "GEMINI_API_KEY" : "MINIMAX_API_KEY"})`,
    );
    return { consulted: 0, agreed: 0, mode };
  }
  const cap = Math.max(1, opts.maxConsults ?? 4);
  const rows: DraftDecisionRow[] = [];
  for (const attempt of opts.attempts.slice(0, cap)) {
    rows.push(
      await consultDraftDecision({
        project: opts.project,
        attempt,
        provider,
        mode: "shadow",
      }),
    );
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
  };
}
