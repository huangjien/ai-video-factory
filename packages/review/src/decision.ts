/**
 * The review-verdict decision seam — the `video review` agent's own
 * per-section verdict, measured.
 *
 * The review agent writes three files (`content-review.yaml`,
 * `visual-review.yaml`, `technical-review.yaml`), each ending in an
 * `overall` verdict: `pass` | `warn` | `fail`. That verdict is the
 * agent's conclusion, and the draft-bar surface has already shown what
 * happens when a decision model is asked to re-derive one: it mostly
 * agrees, and where it does not, the disagreement is a threshold shift
 * rather than noise.
 *
 * This surface asks the model the same question about a DIFFERENT
 * artifact — the review agent's section — and the state deliberately
 withholds the section's own `overall`: the model has to read the
 * findings and decide the verdict they earn. Carrying the verdict in
 * the state would make the question "repeat what you were told".
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
import type { ReviewPackage } from "./schemas.js";

/** One scalar field of a review section. */
export interface ReviewFieldFacts {
  name: string;
  status: "ok" | "warn" | "fail";
  evidence?: string | undefined;
}

/** One structured finding of a review section. */
export interface ReviewFindingFacts {
  id?: string | undefined;
  severity?: string | undefined;
  reference?: string | undefined;
  observation: string;
  evidence?: string | undefined;
}

/** The facts of one review section — everything but its verdict. */
export interface ReviewSectionFacts {
  section: "content" | "visual" | "technical";
  fields: ReviewFieldFacts[];
  findings: ReviewFindingFacts[];
}

/**
 * Split a review section into its scalar fields and its findings.
 *
 * The section's own `overall` is deliberately NOT part of the result —
 * the state must not carry the answer.
 */
export function reviewSectionFacts(
  pkg: ReviewPackage,
  section: "content" | "visual" | "technical",
): ReviewSectionFacts {
  const fields: ReviewFieldFacts[] = [];
  const findings: ReviewFindingFacts[] = [];
  const body = pkg[section] as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(body)) {
    if (key === "overall") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          findings.push({
            ...(record["id"] !== undefined ? { id: String(record["id"]) } : {}),
            ...(record["severity"] !== undefined
              ? { severity: String(record["severity"]) }
              : {}),
            ...(record["reference"] !== undefined &&
            record["reference"] !== null
              ? { reference: String(record["reference"]) }
              : {}),
            observation: String(record["observation"] ?? ""),
            ...(record["evidence"] !== undefined && record["evidence"] !== null
              ? { evidence: String(record["evidence"]) }
              : {}),
          });
        }
      }
      continue;
    }
    if (value && typeof value === "object" && "status" in value) {
      const record = value as Record<string, unknown>;
      fields.push({
        name: key,
        status: String(record["status"]) as "ok" | "warn" | "fail",
        ...(record["evidence"] !== undefined && record["evidence"] !== null
          ? { evidence: String(record["evidence"]) }
          : {}),
      });
    }
  }
  return { section, fields, findings };
}

/**
 * The deterministic verdict for a review section — what a rule, not a
 * model, would answer from the same facts.
 *
 * The rule is the obvious one: a field that failed fails the section, a
 * field that warned (or a serious finding) warns it, and a clean section
 * passes. It is the baseline the decision model has to beat, and it is
 * the same function the corpus is built with, so the two cannot drift.
 */
export function sectionVerdictBaseline(section: ReviewSectionFacts): string {
  if (section.fields.some((f) => f.status === "fail")) return "fail";
  if (section.fields.some((f) => f.status === "warn")) return "warn";
  const serious = section.findings.some((f) => {
    const severity = (f.severity ?? "").toLowerCase();
    return (
      severity === "critical" || severity === "major" || severity === "fail"
    );
  });
  if (serious) return "warn";
  return "pass";
}

/** One review-verdict log row. */
export interface ReviewDecisionRow {
  ts: string;
  surface: "review-verdict";
  project: string;
  section: string;
  mode: DecisionMode;
  provider: string;
  model: string;
  state_sha256: string;
  answer: string | null;
  confidence: number | null;
  confidence_source: string | null;
  /** The artifact's own verdict — the baseline the answer is compared
   *  against. It is NOT in the state: the model has to earn it. */
  baseline: string | null;
  /** Did the decision agree with the review agent's verdict? */
  agreed: boolean | null;
  latency_ms: number;
  usage: { input: number; output: number };
  error: string | null;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * The state a review-verdict decision sees: the section's fields and
 * findings, without the section's own verdict.
 *
 * The corpus's review-verdict cases are built by THIS function, so a
 * case and a shadow-run consult have the same shape.
 */
export function buildReviewVerdictState(section: ReviewSectionFacts): string {
  const lines = [`The ${section.section} section of a review.`];
  if (section.fields.length > 0) {
    lines.push("", "Fields:");
    for (const field of section.fields) {
      const evidence =
        field.evidence !== undefined && field.evidence.trim() !== ""
          ? ` — ${clip(field.evidence, 200)}`
          : "";
      lines.push(`- ${field.name}: ${field.status}${evidence}`);
    }
  }
  if (section.findings.length > 0) {
    lines.push("", "Findings:");
    for (const finding of section.findings) {
      const id = finding.id !== undefined ? `${finding.id}: ` : "";
      const severity =
        finding.severity !== undefined ? `[${finding.severity}] ` : "";
      const reference =
        finding.reference !== undefined && finding.reference !== ""
          ? ` (${clip(finding.reference, 80)})`
          : "";
      lines.push(
        `- ${id}${severity}${clip(finding.observation, 220)}${reference}`,
      );
    }
  } else {
    lines.push("", "No findings.");
  }
  return lines.join("\n");
}

/** The question the review-verdict decision is asked. */
export function reviewVerdictQuestion(section: string): DecisionQuestion {
  const spec = DECISION_QUESTIONS["review-verdict"];
  return {
    id: `review-verdict:${section}`,
    kind: "choice",
    instructions: loadDecisionQuestion("review-verdict"),
    ...(spec.options ? { options: spec.options } : {}),
    ...(spec.resultProperty ? { resultProperty: spec.resultProperty } : {}),
  };
}

/** Ask the decision model what verdict a review section earns, and
 *  record the answer beside the artifact's own verdict. */
export async function consultReviewVerdict(opts: {
  project: string;
  section: ReviewSectionFacts;
  /** The artifact's own verdict — the baseline, never part of the
   *  state. */
  baseline: string | null;
  provider: DecisionProvider;
  mode: DecisionMode;
}): Promise<ReviewDecisionRow> {
  const state = buildReviewVerdictState(opts.section);
  const result = await consultDecision({
    provider: opts.provider,
    question: reviewVerdictQuestion(opts.section.section),
    state,
  });
  return {
    ts: new Date().toISOString(),
    surface: "review-verdict",
    project: opts.project,
    section: opts.section.section,
    mode: opts.mode,
    provider: result.provider,
    model: result.model,
    state_sha256: createHash("sha256").update(state).digest("hex"),
    answer: result.answer,
    confidence: result.confidence,
    confidence_source: result.confidenceSource,
    baseline: opts.baseline,
    agreed:
      result.answer === null || opts.baseline === null
        ? null
        : result.answer === opts.baseline,
    latency_ms: result.latencyMs,
    usage: result.usage,
    error: result.error,
  };
}

/**
 * The shadow pass, as the pipeline calls it: consult the decision model
 * about every review section and append the answers to the project's
 * decision log.
 */
export async function runReviewVerdictShadow(opts: {
  project: string;
  sections: { section: ReviewSectionFacts; baseline: string | null }[];
  mode?: DecisionMode | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  provider?: DecisionProvider | undefined;
  logPath?: string | undefined;
}): Promise<{ consulted: number; agreed: number; mode: DecisionMode }> {
  const env = opts.env ?? process.env;
  const mode = opts.mode ?? resolveDecisionMode(env);
  if (mode === "off" || opts.sections.length === 0) {
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
      `  decision shadow (review) skipped: ${provider.name} key not set (${provider.name === "openai" ? "OPENAI_API_KEY" : "MINIMAX_API_KEY"})`,
    );
    return { consulted: 0, agreed: 0, mode };
  }
  const rows: ReviewDecisionRow[] = [];
  for (const entry of opts.sections) {
    rows.push(
      await consultReviewVerdict({
        project: opts.project,
        section: entry.section,
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
