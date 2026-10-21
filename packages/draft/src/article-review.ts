import { z } from "zod";
import type { Provider } from "@video/llm";
import { chatWithFallback, stripReasoning } from "@video/llm";
import { loadPrompt } from "@video/prompts";
import { callDraft, extractBalancedJson } from "./agent.js";
import { withChannelBlock } from "./channel-profile.js";
import type { DraftInput } from "./prompt.js";

/**
 * Article quality gate (2026-10-03, refined 2026-11 against the
 * `general_article_v1` profile). The judge scores the candidate
 * article across 8 dimensions × 24 indicators (0-5 each); the engine
 * applies fixed weights, derives `overall_score` / `grade` /
 * `coverage`, and the loop regenerates drafts with the judge's
 * `comment` + `suggestions` until `overall_score ≥ minScore` AND no
 * `Critical` finding sits in `risk_flags`. The best candidate wins.
 *
 * Profile weights are documented in `draft-article-review.md` and
 * mirrored in `PROFILE` below. The same dim/indicator id is what the
 * prompt asks the LLM to emit — schema and prompt live in lock-step.
 */

// ---------------------------------------------------------------------------
// 1. Profile — weights & grading bands (hardcoded for v1).
// ---------------------------------------------------------------------------

export interface DimensionDef {
  id: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
  name: string;
  weight: number;
  indicators: { id: string; weight: number }[];
}

export const PROFILE: DimensionDef[] = [
  {
    id: "A",
    name: "Content Quality",
    weight: 15,
    indicators: [
      { id: "A1", weight: 5 },
      { id: "A2", weight: 5 },
      { id: "A3", weight: 5 },
    ],
  },
  {
    id: "B",
    name: "Logic & Coherence",
    weight: 15,
    indicators: [
      { id: "B1", weight: 6 },
      { id: "B2", weight: 5 },
      { id: "B3", weight: 4 },
    ],
  },
  {
    id: "C",
    name: "Structure & Organization",
    weight: 12,
    indicators: [
      { id: "C1", weight: 4 },
      { id: "C2", weight: 4 },
      { id: "C3", weight: 4 },
    ],
  },
  {
    id: "D",
    name: "Language & Expression",
    weight: 15,
    indicators: [
      { id: "D1", weight: 6 },
      { id: "D2", weight: 5 },
      { id: "D3", weight: 4 },
    ],
  },
  {
    id: "E",
    name: "Readability & Reader Experience",
    weight: 12,
    indicators: [
      { id: "E1", weight: 4 },
      { id: "E2", weight: 4 },
      { id: "E3", weight: 4 },
    ],
  },
  {
    id: "F",
    name: "Originality & Information Delta",
    weight: 10,
    indicators: [
      { id: "F1", weight: 4 },
      { id: "F2", weight: 3 },
      { id: "F3", weight: 3 },
    ],
  },
  {
    id: "G",
    name: "Facts & Internal Consistency",
    weight: 13,
    indicators: [
      { id: "G1", weight: 6 },
      { id: "G2", weight: 4 },
      { id: "G3", weight: 3 },
    ],
  },
  {
    id: "H",
    name: "Instruction Compliance",
    weight: 8,
    indicators: [
      { id: "H1", weight: 3 },
      { id: "H2", weight: 3 },
      { id: "H3", weight: 2 },
    ],
  },
];

const DIM_BY_ID: Record<string, DimensionDef> = Object.fromEntries(
  PROFILE.map((d) => [d.id, d]),
);

export const PROFILE_ID = "general_article_v1" as const;

/** Acceptance bar: 90/100 = A (2026-10-18 — user directive: only A-grade
 *  articles auto-pass; everything else iterates to the attempt cap and the
 *  top-scoring candidate wins regardless of passing). History: 70 = C
 *  ("基本可用") before that, 25/30 ≈ 83% before v0.9. */
export const DEFAULT_MIN_SCORE = 90;

/** Total possible — sum of dimension weights, used by the engine only
 *  for the percentage form. */
export const MAX_POSSIBLE_SCORE = PROFILE.reduce(
  (sum, d) => sum + d.weight,
  0,
); // 100

// ---------------------------------------------------------------------------
// 2. Severity / grading helpers — pure functions, no LLM.
// ---------------------------------------------------------------------------

export const SEVERITIES = ["Critical", "Major", "Moderate", "Minor"] as const;
export type Severity = (typeof SEVERITIES)[number];

const zSeverity = z.enum(["Critical", "Major", "Moderate", "Minor"]);

/** The model occasionally labels a severity outside the documented four
 *  ("Informational" seen 2026-10-21). Strict rejection there threw away
 *  the WHOLE judgement — every dimension, every finding — because of one
 *  invented word on one flag. Accept the wider vocabulary the models
 *  actually produce and normalize it onto the scale the gate reads:
 *  anything below Moderate is informational, which is exactly what the
 *  gate should do with it (it blocks on Critical, nothing else). */
const SEVERITY_ALIASES: Record<string, Severity> = {
  informational: "Minor",
  info: "Minor",
  negligible: "Minor",
  low: "Minor",
  medium: "Moderate",
  moderate: "Moderate",
  high: "Major",
  blocker: "Critical",
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

const zSeverityInput = z
  .string()
  .transform((s) => SEVERITY_ALIASES[s.trim().toLowerCase()] ?? "Moderate");

const zVerification = z.enum([
  "verified_in_text",
  "needs_external_check",
  "removed_for_weakness",
]);

/** Map a 0-100 score to a letter grade. Bands are the framework's
 *  initial cut and stay fixed until a labelled set is collected. */
export function gradeFor(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// 3. LLM-output schema — what the judge is asked to emit. Weight math
//    is intentionally NOT trusted from the model: the engine recomputes
//    it, so the LLM cannot inflate its own score.
// ---------------------------------------------------------------------------

const zIndicator = z.object({
  id: z.string(),
  /** 0-5 integer. The model may emit floats; we round. Clamp on out-of-range. */
  score: z.coerce.number().transform((n) =>
    Math.min(5, Math.max(0, Math.round(n))),
  ),
  reason: z.string().default(""),
});

const zDimension = z.object({
  id: z.enum(["A", "B", "C", "D", "E", "F", "G", "H"]),
  indicators: z.array(zIndicator).min(1),
});

const zLocation = z
  .object({
    quote: z.string(),
    start_char: z.coerce.number().optional(),
    end_char: z.coerce.number().optional(),
  })
  .strict();

const zFinding = z
  .object({
    id: z.string(),
    code: z.string().min(2),
    severity: zSeverityInput,
    dimension_ids: z.array(z.string()).min(1),
    indicator_ids: z.array(z.string()).default([]),
    location: zLocation,
    description: z.string(),
    impact: z.string().default(""),
    recommendation: z.string().default(""),
    confidence: z.coerce
      .number()
      .transform((n) => Math.min(1, Math.max(0, n)))
      .default(0.5),
    verification_status: zVerification.default("verified_in_text"),
  })
  .strict();

const zRiskFlag = z
  .object({
    code: z.string(),
    severity: zSeverityInput,
    finding_ids: z.array(z.string()).default([]),
  })
  .strict();

const zLimitation = z
  .object({
    code: z.string(),
    description: z.string().default(""),
    affected_dimensions: z.array(z.string()).default([]),
  })
  .strict();

const zSummary = z
  .object({
    strengths: z.array(z.string()).default([]),
    main_weaknesses: z.array(z.string()).default([]),
    conclusion: z.string().default(""),
    confidence: z.coerce
      .number()
      .transform((n) => Math.min(1, Math.max(0, n)))
      .default(0.5),
  })
  .strict();

/** Raw payload the LLM returns. We keep `comment` + `suggestions`
 *  because they're the fields the drafter receives as feedback on
 *  the next loop; everything else is for display + archival. */
export const ArticleScoreRawSchema = z
  .object({
    dimension_scores: z.array(zDimension).min(1),
    findings: z.array(zFinding).default([]),
    risk_flags: z.array(zRiskFlag).default([]),
    limitations: z.array(zLimitation).default([]),
    summary: zSummary.default({
      strengths: [],
      main_weaknesses: [],
      conclusion: "",
      confidence: 0.5,
    }),
    comment: z.string().default(""),
    suggestions: z.array(z.string()).default([]),
  })
  .strict();

export type ArticleScoreRaw = z.infer<typeof ArticleScoreRawSchema>;

// ---------------------------------------------------------------------------
// 4. Engine — turns the raw LLM payload into the final article score.
// ---------------------------------------------------------------------------

export interface DimensionScore {
  id: string;
  name: string;
  weight: number;
  /** Mean of indicator scores (0-5). Stored for display. */
  indicator_mean: number;
  /** Dimension's slice of overall_score (0-100). */
  weighted_score: number;
}

export interface ComputedScore {
  /** Sum of dimension weighted scores, 0-100. Engine-computed, never trusted from the LLM. */
  overall_score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  /** Sum of applicable dimension weights — allows normalization if any dim was dropped. */
  applicable_weight: number;
  /** Sum of applicable dimensions that the LLM actually scored. */
  assessed_weight: number;
  coverage: number;
  dimension_scores: DimensionScore[];
}

/** Compute per-dimension + overall score from the raw payload. */
export function computeScore(raw: ArticleScoreRaw): ComputedScore {
  const requested = new Map(raw.dimension_scores.map((d) => [d.id, d]));

  const dimension_scores: DimensionScore[] = [];
  let applicable_weight = 0;
  let assessed_weight = 0;
  let weighted_total = 0;

  for (const def of PROFILE) {
    applicable_weight += def.weight;
    const got = requested.get(def.id);
    if (!got) continue;

    const indWeight = new Map(def.indicators.map((i) => [i.id, i.weight]));
    let indWeightSum = 0;
    let weightedSum = 0;
    let indicatorCount = 0;
    let indicator_total = 0;
    for (const ind of got.indicators) {
      const w = indWeight.get(ind.id);
      if (w === undefined) continue;
      indWeightSum += w;
      weightedSum += w * ind.score;
      indicatorCount += 1;
      indicator_total += ind.score;
    }
    if (indWeightSum === 0) continue;

    const mean_0_5 = indicator_total / Math.max(1, indicatorCount);
    const dim_0_5 = weightedSum / indWeightSum; // dimension's mean indicator score
    // Slice = dim_weight * (dim_mean / 5).
    const slice = def.weight * (dim_0_5 / 5);
    weighted_total += slice;
    assessed_weight += def.weight;
    dimension_scores.push({
      id: def.id,
      name: def.name,
      weight: def.weight,
      indicator_mean: mean_0_5,
      weighted_score: round1(slice),
    });
  }

  // Coverage on assessed weight; overall on the applicable weight basis
  // (a dropped dimension drops its slice from the numerator AND the
  // denominator — but here we always run all 8 dims, so the rare case
  // where the LLM skips one still reads as a coverage gap).
  const normDenom =
    assessed_weight > 0 ? assessed_weight : applicable_weight;
  const overall = normDenom > 0 ? (weighted_total * 100) / normDenom : 0;

  return {
    overall_score: round1(overall),
    grade: gradeFor(overall),
    applicable_weight,
    assessed_weight,
    coverage:
      applicable_weight > 0
        ? round1((assessed_weight / applicable_weight) * 100)
        : 0,
    dimension_scores,
  };
}

/** True when the article passes the bar. A Critical finding always
 *  blocks — the numeric score alone never certifies a Critical-defect
 *  draft. */
export function passesBar(
  score: ComputedScore,
  riskFlags: { severity: Severity }[],
  hasBlockedFindings: boolean,
): { passing: boolean; reason: string } {
  if (hasBlockedFindings) {
    return {
      passing: false,
      reason: "a Critical finding sits in risk_flags",
    };
  }
  return { passing: true, reason: "" };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// 5. The score object the rest of the system sees.
// ---------------------------------------------------------------------------

export interface ArticleScore {
  profile_id: string;
  raw: ArticleScoreRaw;
  computed: ComputedScore;
  /** True when overall_score ≥ minScore AND no Critical risk_flag. */
  passing: boolean;
  /** Top-level `comment` for the drafter feedback block. */
  comment: string;
  suggestions: string[];
  /** Total computed overall_score (0-100). Convenience field — same as `computed.overall_score`. */
  total: number;
}

// ---------------------------------------------------------------------------
// 6. Evidence review (pass 4 in the prompt's procedure).
// ---------------------------------------------------------------------------

/** Strip findings whose quote does not appear in the article. The
 *  LLM may invent a quote under load; the engine catches it before
 *  the writer sees a phantom defect. Quoted substring ≥ 6 chars or
 *  shorter quotes that appear exactly. */
export function dropHallucinatedQuotes(
  findings: z.infer<typeof zFinding>[],
  markdown: string,
): { kept: z.infer<typeof zFinding>[]; dropped: string[] } {
  const kept: z.infer<typeof zFinding>[] = [];
  const dropped: string[] = [];
  for (const f of findings) {
    const q = f.location.quote;
    if (q.length < 6) {
      // Too short to verify reliably — accept only as a hint,
      // mark for external check. Still kept, not "dropped".
      kept.push({ ...f, verification_status: "needs_external_check" });
      continue;
    }
    if (markdown.includes(q)) {
      kept.push(f);
    } else {
      dropped.push(f.id);
    }
  }
  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// 7. Public API — `scoreArticle`, `runScoredDraft`, `render...`
// ---------------------------------------------------------------------------

/** Body lives in `packages/prompts/prompts/draft-article-review.md` — edit it there. */
export const ARTICLE_REVIEW_SYSTEM_PROMPT = loadPrompt("draft-article-review");

/** The task the article was commissioned to fill. Dimension H
 *  (Instruction Compliance, weight 8) can only be scored when the judge
 *  can see what was actually asked. It could not: the judge received the
 *  article alone, so H always scored 0 and the 90/100 bar was
 *  unreachable by construction (max 92, and passing needed 97.8% of the
 *  rest). These fields close that gap — the drafter already had them. */
export interface ReviewTaskSpec {
  topic: string;
  audience?: string | undefined;
  language?: string | undefined;
  durationSec?: number | undefined;
  /** Extra constraints the operator passed (e.g. `--style`, `--bgm`). */
  constraints?: string | undefined;
}

/** What the judge is shown.
 *
 *  The review used to pass `markdown.slice(0, 12000)`. A finished
 *  article is routinely longer than that — the en-US rewrite was 36,658
 *  chars — so the judge read a prefix that stopped mid-word and then
 *  reported the truncation as a CONTENT defect: "Section 10 ends
 *  mid-sentence… the article never finishes", filed Critical, and
 *  dragged the score down with it. It happened on both drafts and it is
 *  not something a writer can fix; only the judge can see more.
 *
 *  Truncation is still a guard against a runaway draft, but it is now
 *  (a) far above any real article and (b) LOUD: when the tail is cut,
 *  the judge is told the article was cut and must not treat the cut as
 *  the author's failure to write. */
const JUDGE_ARTICLE_LIMIT = 120_000;

function judgeableArticle(markdown: string): string {
  if (markdown.length <= JUDGE_ARTICLE_LIMIT) return markdown;
  const kept = markdown.slice(0, JUDGE_ARTICLE_LIMIT);
  const omitted = markdown.length - JUDGE_ARTICLE_LIMIT;
  return `${kept}

---

[NOTE: the article above was truncated for length — ${omitted} more characters were withheld from you. Do NOT report the cut as a structural defect, a missing section, or an unfinished sentence. Judge only what you were given, and if you cannot verify a finding from this excerpt, mark it unverified.]`;
}

export function buildArticleReviewMessages(
  markdown: string,
  channelProfile?: string,
  task?: ReviewTaskSpec,
): {
  role: "system" | "user";
  content: string;
}[] {
  // Without a task spec the judge must still be told to mark H as
  // not-assessed rather than inventing a requirement it cannot see.
  const brief = task
    ? [
        "## Commissioned task",
        "",
        `- topic: ${task.topic}`,
        task.audience ? `- target audience: ${task.audience}` : null,
        task.language ? `- narration language: ${task.language}` : null,
        task.durationSec
          ? `- target duration: ${task.durationSec} seconds`
          : null,
        task.constraints ? `- additional constraints: ${task.constraints}` : null,
        "",
        "Score dimension H against THIS task. If a field is absent, judge only what is present and mark the rest `not_assessed`.",
      ]
          .filter((l) => l !== null)
          .join("\n")
    : "## Commissioned task\n\n(unknown — the judge was not given the task. Mark H1-H3 `not_assessed`; do not assume a requirement you cannot see.)";

  return [
    {
      role: "system",
      content: withChannelBlock(
        ARTICLE_REVIEW_SYSTEM_PROMPT,
        channelProfile,
        "review",
      ),
    },
    {
      role: "user",
      content: `${brief}\n\n## Article to judge\n\n${judgeableArticle(markdown)}\n\nProduce the score JSON.`,
    },
  ];
}

export class ArticleReviewError extends Error {
  override readonly cause: unknown;
  constructor(
    message: string,
    public readonly providerName: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "ArticleReviewError";
    this.cause = cause;
  }
}

/** Parse, evidence-check, and compute. Throws ArticleReviewError on
 *  provider failure or schema invalid; returns ArticleScore on success. */
export async function scoreArticle(
  markdown: string,
  provider: Provider,
  fallback?: Provider | null,
  channelProfile?: string,
  task?: ReviewTaskSpec,
): Promise<ArticleScore> {
  const out = await chatWithFallback(provider, fallback ?? null, {
    messages: buildArticleReviewMessages(markdown, channelProfile, task),
  });
  // CS-14: the judge's reasoning block carries a JSON sketch too —
  // extract it from the ANSWER, not from the thinking.
  const parsed = extractBalancedJson(stripReasoning(out.response.content));
  if (!parsed) {
    throw new ArticleReviewError(
      "no JSON object in judge response",
      out.provider,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(parsed);
  } catch (err) {
    throw new ArticleReviewError(
      `judge JSON parse failed: ${(err as Error).message}`,
      out.provider,
      err,
    );
  }
  const validated = ArticleScoreRawSchema.safeParse(raw);
  if (!validated.success) {
    throw new ArticleReviewError(
      `judge score schema invalid: ${validated.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      out.provider,
      validated.error,
    );
  }
  const rawScore = validated.data;

  // Evidence review (pass 4 in the prompt's procedure) — drop
  // findings whose quote doesn't actually appear in the article.
  const { kept, dropped } = dropHallucinatedQuotes(
    rawScore.findings,
    markdown,
  );
  const findings = kept;
  const riskFlags = rawScore.risk_flags.filter(
    (rf) =>
      rf.finding_ids.length === 0 ||
      rf.finding_ids.every((id) => findings.some((f) => f.id === id)),
  );

  const computed = computeScore({ ...rawScore, findings });
  const hasBlocked = riskFlags.some((rf) => rf.severity === "Critical");
  const { passing } = passesBar(computed, riskFlags, hasBlocked);

  return {
    profile_id: PROFILE_ID,
    raw: { ...rawScore, findings, risk_flags: riskFlags },
    computed,
    passing,
    comment: rawScore.comment,
    suggestions: rawScore.suggestions,
    total: computed.overall_score,
  };
}

/** Sum of the three old axes — kept as a no-op so legacy callers
 *  that import `scoreTotal` keep compiling. Returns `total`. */
export function scoreTotal(s: { total: number }): number {
  return s.total;
}

// ---------------------------------------------------------------------------
// 8. Loop.
// ---------------------------------------------------------------------------

export interface ScoredAttempt {
  attempt: number;
  markdown: string;
  score: ArticleScore | null;
  /** Why there is no score (judge failed) — absent when scored. */
  scoreError?: string;
  passing: boolean;
  usage: { input: number; output: number };
}

export interface ScoredDraftResult {
  /** Best-scoring candidate (first attempt wins ties). */
  markdown: string;
  /** Score of `markdown`; null when the judge never produced a score. */
  score: ArticleScore | null;
  attempts: ScoredAttempt[];
  /** True when attempt 1 was rejected and a later draft was chosen. */
  regenerated: boolean;
  /** True when the returned article met `minScore`. */
  passing: boolean;
  usage: { input: number; output: number };
  providerName: string;
}

export interface ScoredDraftOptions {
  /** Minimum overall_score (0-100) to accept. Default 70. */
  minScore?: number;
  /** Total number of draft attempts (not retries). Default 3. */
  maxAttempts?: number;
  /** Progress callback for CLI logging. */
  onAttempt?: (a: ScoredAttempt, total: number) => void;
}

function feedbackBlock(prev: ScoredAttempt, minScore: number): string {
  const s = prev.score;
  if (!s) return "";
  const lines: string[] = [
    `The previous draft scored ${s.computed.overall_score}/100 (grade ${s.computed.grade}, coverage ${s.computed.coverage}%) — below the acceptance bar of ${minScore}/100.`,
  ];
  const blockers = s.raw.risk_flags.filter((r) => r.severity === "Critical");
  if (blockers.length > 0) {
    lines.push(
      `Critical risk flags present (${blockers.map((r) => r.code).join(", ")}) — these block passing regardless of the numeric score.`,
    );
  }
  if (s.comment) lines.push(`Judge's main criticism: ${s.comment}`);
  if (s.suggestions.length > 0) {
    lines.push("Fix these specific points in the rewrite:");
    s.suggestions.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
  }
  if (s.raw.findings.length > 0) {
    const majors = s.raw.findings.filter(
      (f) => f.severity === "Critical" || f.severity === "Major",
    );
    if (majors.length > 0) {
      lines.push("Critical / Major findings the rewrite must address:");
      for (const f of majors.slice(0, 5)) {
        lines.push(
          `- [${f.severity}] ${f.code} — ${f.description}${
            f.location.quote ? ` (evidence: "${f.location.quote.slice(0, 80)}…")` : ""
          }`,
        );
      }
    }
  }
  lines.push(
    "Rewrite the FULL article addressing these findings. Keep what worked; do not just touch it up cosmetically.",
  );
  return lines.join("\n");
}

/** Draft → score → (regenerate with feedback until score ≥ minScore
 *  and no Critical risk flag) → best candidate. Never throws on
 *  quality — only `callDraft` failures propagate; a judge failure
 *  degrades to accepting the current draft unreviewed. */
export async function runScoredDraft(
  input: DraftInput,
  provider: Provider,
  fallback: Provider | null,
  opts: ScoredDraftOptions = {},
): Promise<ScoredDraftResult> {
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  // 8 attempts (2026-10-18 user directive, paired with the A-grade bar):
  // few drafts clear 90 early, so the loop usually spends the full budget
  // and the best-scoring candidate is kept regardless of passing.
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 8);

  const attempts: ScoredAttempt[] = [];
  const usage = { input: 0, output: 0 };
  let providerName = provider.name;
  let feedback: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const draftInput: DraftInput =
      feedback !== undefined ? { ...input, feedback } : input;
    const draft = await callDraft(draftInput, provider, fallback ?? undefined);
    usage.input += draft.usage.input;
    usage.output += draft.usage.output;
    providerName = draft.providerName;

    let score: ArticleScore | null = null;
    let scoreError: string | undefined;
    try {
      score = await scoreArticle(
        draft.markdown,
        provider,
        fallback,
        input.channelProfile,
        // Dimension H needs the commission, not just the article —
        // see ReviewTaskSpec.
        {
          topic: input.topic,
          audience: input.audience,
          language: input.language,
          durationSec: input.duration,
        },
      );
    } catch (err) {
      scoreError = (err as Error).message;
    }

    const entry: ScoredAttempt = {
      attempt,
      markdown: draft.markdown,
      score,
      ...(scoreError !== undefined ? { scoreError } : {}),
      // No score ≠ passing — it means unreviewed (judge broke); the
      // loop still accepts the draft below, but the report must not
      // claim a pass.
      passing:
        score !== null &&
        score.passing &&
        score.computed.overall_score >= minScore,
      usage: draft.usage,
    };
    attempts.push(entry);
    opts.onAttempt?.(entry, maxAttempts);

    // Judge broke down: no basis to iterate — accept this draft.
    if (score === null) break;
    if (entry.passing) break;

    // Last attempt: no point asking for another rewrite.
    if (attempt === maxAttempts) break;
    feedback = feedbackBlock(entry, minScore);
  }

  // Best wins, period: after the final attempt the top-scoring candidate is
  // returned even when nothing passed the bar (user directive 2026-10-18 —
  // "after 8 times, use the top score one, no matter what"). `passing` is
  // reported honestly alongside; selection itself is score-only.
  // maxAttempts ≥ 1 ⇒ the loop ran at least once.
  let best = attempts[0]!;
  for (const a of attempts) {
    const aScore = a.score?.computed.overall_score ?? -1;
    const bScore = best.score?.computed.overall_score ?? -1;
    if (aScore > bScore) best = a;
  }
  return {
    markdown: best.markdown,
    score: best.score,
    attempts,
    regenerated: best.attempt !== 1 && attempts.length > 1,
    passing: best.passing,
    usage,
    providerName,
  };
}

// ---------------------------------------------------------------------------
// 9. Reporting.
// ---------------------------------------------------------------------------

/** Serialize the loop outcome to the `article-review.yaml` sidecar.
 *  Rich format: per-dimension weighted scores, severity-tagged
 *  findings, risk_flags, limitations, and the drafter's `comment` +
 *  `suggestions`. */
export function renderArticleReviewYaml(
  result: ScoredDraftResult,
  meta: { project: string; threshold: number; language: string },
): string {
  const esc = (s: string): string =>
    /[:#\n{}[\],&*?|>'"%@`]/.test(s) ? JSON.stringify(s) : s;
  const lines: string[] = [
    `project: ${esc(meta.project)}`,
    `language: ${meta.language}`,
    `profile: ${PROFILE_ID}`,
    `threshold: ${meta.threshold}`,
    `attempts_used: ${result.attempts.length}`,
    `passing: ${result.passing}`,
  ];
  if (result.score) {
    lines.push(
      `final_overall: ${result.score.computed.overall_score}`,
      `final_grade: ${result.score.computed.grade}`,
      `final_coverage: ${result.score.computed.coverage}`,
    );
  } else {
    lines.push(`final_overall: null`, `final_grade: null`, `final_coverage: null`);
  }
  lines.push(`attempts:`);
  for (const a of result.attempts) {
    lines.push(`  - attempt: ${a.attempt}`);
    if (a.score) {
      lines.push(
        `    overall: ${a.score.computed.overall_score}`,
        `    grade: ${a.score.computed.grade}`,
        `    coverage: ${a.score.computed.coverage}`,
        `    passing: ${a.passing}`,
        `    dimensions:`,
      );
      for (const d of a.score.computed.dimension_scores) {
        lines.push(
          `      - id: ${d.id}`,
          `        name: ${esc(d.name)}`,
          `        weight: ${d.weight}`,
          `        indicator_mean: ${d.indicator_mean}`,
          `        weighted_score: ${d.weighted_score}`,
        );
      }
      if (a.score.raw.findings.length > 0) {
        lines.push(`    findings:`);
        for (const f of a.score.raw.findings) {
          lines.push(
            `      - id: ${esc(f.id)}`,
            `        code: ${esc(f.code)}`,
            `        severity: ${f.severity}`,
            `        dimension_ids: [${f.dimension_ids.map((x) => esc(x)).join(", ")}]`,
            `        indicator_ids: [${f.indicator_ids.map((x) => esc(x)).join(", ")}]`,
            `        quote: ${esc(f.location.quote)}`,
            `        description: ${esc(f.description)}`,
            `        impact: ${esc(f.impact)}`,
            `        recommendation: ${esc(f.recommendation)}`,
            `        confidence: ${f.confidence}`,
            `        verification_status: ${f.verification_status}`,
          );
        }
      }
      if (a.score.raw.risk_flags.length > 0) {
        lines.push(`    risk_flags:`);
        for (const r of a.score.raw.risk_flags) {
          lines.push(
            `      - code: ${esc(r.code)}`,
            `        severity: ${r.severity}`,
            `        finding_ids: [${r.finding_ids.map((x) => esc(x)).join(", ")}]`,
          );
        }
      }
      if (a.score.raw.limitations.length > 0) {
        lines.push(`    limitations:`);
        for (const l of a.score.raw.limitations) {
          lines.push(
            `      - code: ${esc(l.code)}`,
            `        description: ${esc(l.description)}`,
            `        affected_dimensions: [${l.affected_dimensions.map((x) => esc(x)).join(", ")}]`,
          );
        }
      }
      lines.push(
        `    comment: ${esc(a.score.comment)}`,
      );
      if (a.score.suggestions.length > 0) {
        lines.push(`    suggestions:`);
        for (const s of a.score.suggestions) lines.push(`      - ${esc(s)}`);
      }
    } else {
      lines.push(
        `    score: null`,
        `    error: ${esc(a.scoreError ?? "unknown")}`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}
