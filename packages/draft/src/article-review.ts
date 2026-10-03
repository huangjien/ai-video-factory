import { z } from "zod";
import type { Provider } from "@video/llm";
import { chatWithFallback } from "@video/llm";
import { callDraft, extractBalancedJson } from "./agent.js";
import type { DraftInput } from "./prompt.js";

/**
 * Article quality gate (flow design 2026-10-03): after `callDraft` writes a
 * candidate article, an LLM judge rates it on three axes — attractive,
 * interesting, useful — 0-10 each (30 max). Below `minScore` (default 25)
 * the article is regenerated with the judge's suggestions as feedback,
 * up to `maxAttempts` total drafts. The best-scoring candidate wins.
 */

export const ARTICLE_SCORE_AXES = [
  "attractive",
  "interesting",
  "useful",
] as const;

/** Raw judge payload. Axes are coerced + clamped (LLMs emit floats and
 * occasional 11s); `total` is computed by us, never trusted from the LLM. */
const axis = z.coerce
  .number()
  .transform((n) => Math.min(10, Math.max(0, Math.round(n))));
export const ArticleScoreSchema = z.object({
  attractive: axis,
  interesting: axis,
  useful: axis,
  comment: z.string().default(""),
  suggestions: z.array(z.string()).default([]),
});
export type ArticleScore = ArticleScoreData & { total: number };
type ArticleScoreData = z.infer<typeof ArticleScoreSchema>;

export function scoreTotal(s: {
  attractive: number;
  interesting: number;
  useful: number;
}): number {
  return s.attractive + s.interesting + s.useful;
}

export const ARTICLE_REVIEW_SYSTEM_PROMPT = `You are a strict video-article judge for an AI video pipeline.

Rate the article on EXACTLY three axes, 0-10 each (integers):

- attractive: would the title + opening hook stop the scroll? Is the premise framed with tension or stakes, not a neutral encyclopedia tone?
- interesting: does the body sustain curiosity — concrete scenes, surprising turns, specific details — or is it generic filler?
- useful: does the viewer leave with something they can repeat or apply — a takeaway, a mental model, a lesson — clearly stated at the end?

Anchor points: 3 = mediocre AI slop; 6 = competent but flat; 8 = strong produced-video-essay quality; 10 = exceptional.

Be calibrated and honest: most drafts are a 6-8 per axis. Do NOT inflate scores.

Output: ONE JSON object and nothing else (no prose, no code fence):
{"attractive": <0-10>, "interesting": <0-10>, "useful": <0-10>, "comment": "<one sentence, the single biggest weakness>", "suggestions": ["<concrete, actionable fix>", "..."]}

suggestions: at most 5 items, each a specific instruction the drafter can act on (name the scene or section, say what to change).`;

export function buildArticleReviewMessages(
  markdown: string,
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: ARTICLE_REVIEW_SYSTEM_PROMPT },
    {
      role: "user",
      content: `## Article to judge\n\n${markdown.slice(0, 12000)}\n\nProduce the score JSON.`,
    },
  ];
}

export class ArticleReviewError extends Error {
  override readonly cause: unknown;
  constructor(message: string, public readonly providerName: string, cause?: unknown) {
    super(message);
    this.name = "ArticleReviewError";
    this.cause = cause;
  }
}

/** Ask the LLM judge to score an article. Throws ArticleReviewError on
 * provider failure or unparseable output — callers decide whether to
 * degrade (accept the draft unreviewed) or abort. */
export async function scoreArticle(
  markdown: string,
  provider: Provider,
  fallback?: Provider | null,
): Promise<ArticleScore> {
  const out = await chatWithFallback(provider, fallback ?? null, {
    messages: buildArticleReviewMessages(markdown),
  });
  const parsed = extractBalancedJson(out.response.content);
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
  const result = ArticleScoreSchema.safeParse(raw);
  if (!result.success) {
    throw new ArticleReviewError(
      `judge score schema invalid: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      out.provider,
      result.error,
    );
  }
  return { ...result.data, total: scoreTotal(result.data) };
}

/** One pass of the loop: a draft, its score, and the verdict. */
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
  /** Minimum total (of 30) to accept. Default 25. */
  minScore?: number;
  /** Total number of draft attempts (not retries). Default 3. */
  maxAttempts?: number;
  /** Progress callback for CLI logging. */
  onAttempt?: (a: ScoredAttempt, total: number) => void;
}

function feedbackBlock(prev: ScoredAttempt): string {
  const s = prev.score;
  if (!s) return "";
  const lines = [
    `The previous draft scored attractive=${s.attractive} interesting=${s.interesting} useful=${s.useful} (total ${s.total}/30) — below the acceptance bar.`,
  ];
  if (s.comment) lines.push(`Judge's main criticism: ${s.comment}`);
  if (s.suggestions.length > 0) {
    lines.push("Fix these specific points in the rewrite:");
    s.suggestions.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
  }
  lines.push(
    "Rewrite the FULL article addressing these findings. Keep what worked; do not just touch it up cosmetically.",
  );
  return lines.join("\n");
}

/** Draft → score → (regenerate with feedback until score ≥ minScore or
 *  attempts exhausted) → best candidate. Never throws on quality — only
 *  callDraft failures propagate; a judge failure degrades to accepting
 *  the current draft unreviewed. */
export async function runScoredDraft(
  input: DraftInput,
  provider: Provider,
  fallback: Provider | null,
  opts: ScoredDraftOptions = {},
): Promise<ScoredDraftResult> {
  const minScore = opts.minScore ?? 25;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);

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
      score = await scoreArticle(draft.markdown, provider, fallback);
    } catch (err) {
      scoreError = (err as Error).message;
    }

    const entry: ScoredAttempt = {
      attempt,
      markdown: draft.markdown,
      score,
      ...(scoreError !== undefined ? { scoreError } : {}),
      // No score ≠ passing — it means unreviewed (judge broke); the loop
      // still accepts the draft below, but the report must not claim a pass.
      passing: (score?.total ?? -1) >= minScore,
      usage: draft.usage,
    };
    attempts.push(entry);
    opts.onAttempt?.(entry, maxAttempts);

    // Judge broke down: no basis to iterate — accept this draft.
    if (score === null) break;
    if (entry.passing) break;

    // Last attempt: no point asking for another rewrite.
    if (attempt === maxAttempts) break;
    feedback = feedbackBlock(entry);
  }

  // maxAttempts ≥ 1 ⇒ the loop ran at least once.
  let best = attempts[0]!;
  for (const a of attempts) {
    if ((a.score?.total ?? -1) > (best.score?.total ?? -1)) best = a;
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

/** Serialize the loop outcome to the `article-review.yaml` sidecar. */
export function renderArticleReviewYaml(
  result: ScoredDraftResult,
  meta: { project: string; threshold: number; language: string },
): string {
  const esc = (s: string): string =>
    /[:#\n{}[\],&*?|>'"%@`]/.test(s) ? JSON.stringify(s) : s;
  const lines: string[] = [
    `project: ${esc(meta.project)}`,
    `language: ${meta.language}`,
    `threshold: ${meta.threshold}`,
    `attempts_used: ${result.attempts.length}`,
    `passing: ${result.passing}`,
    `final_total: ${result.score?.total ?? "null"}`,
    `attempts:`,
  ];
  for (const a of result.attempts) {
    lines.push(`  - attempt: ${a.attempt}`);
    if (a.score) {
      lines.push(
        `    attractive: ${a.score.attractive}`,
        `    interesting: ${a.score.interesting}`,
        `    useful: ${a.score.useful}`,
        `    total: ${a.score.total}`,
        `    passing: ${a.passing}`,
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
