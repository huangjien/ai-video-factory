import type { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  GLMProvider,
  MiniMaxProvider,
  judgePickForName,
  loadProviderConfig,
  pickJudgeProvider,
  providerForRole,
  type Provider,
} from "@video/llm";
import {
  applyRevisionToMarkdown,
  articleMdToRawArticle,
  articleToStoryboardYaml,
  callRevise,
  guardUnverifiedFact,
  parseArticleWithRecovery,
  planReviewRevision,
  scoreArticle,
  type ArticleScore,
} from "@video/draft";
import {
  ReviewPackageSchema,
  callReview,
  type ReviewPackage,
} from "@video/review";
import { MiniMaxWebSearch, callResearch } from "@video/research";
import { formatRunId, writeRun } from "@video/workflow";
import { resolveProjectDir } from "./project-path.js";
import { assertStageWritable } from "./stage-guard.js";
import { collectReviewArtifacts, loadReviewPackage } from "./review-command.js";
import { MARK_OK, brandBannerLine, channelHeader } from "./ui.js";

/**
 * `video revise` — close the review loop.
 *
 * `video review` reports what is wrong with the film; `video draft`'s
 * quality loop rewrites the WHOLE article when its own judge complains.
 * Nothing connected the two, so a review finding could only be acted on
 * by hand.
 *
 * This command connects them WITHOUT a rewrite: the review's findings are
 * resolved to the passages they quote, and the surgical reviser edits
 * exactly those passages. Everything else in article.md survives
 * byte-for-byte. One targeted call replaces a full regeneration.
 */

export interface ReviseOptions {
  project: string;
  cwd?: string | undefined;
  /** Provider that performs the revision. */
  model?: "minimax" | "glm" | undefined;
  /** Provider that re-scores the revised article. */
  judgeModel?: "minimax" | "glm" | undefined;
  /** Skip the re-score (the revision still applies). */
  noJudge?: boolean | undefined;
  /** Re-run the review agent on the revised project. */
  reReview?: boolean | undefined;
  /** Fact-check the FACT_* claims before the reviser touches them. Costs
   *  one research call per claim (web search + a model call) and, on
   *  this repo's providers, often fails — the per-finding no-source
   *  rule already stops the reviser from inventing a citation. Off by
   *  default: it is the slow path. */
  research?: boolean | undefined;
  /** Bypass the human-approval guard. */
  force?: boolean | undefined;
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unsupported provider: ${name}`);
}

function modelFor(name: string): string {
  return name === "glm" ? "glm-5.3" : "MiniMax-M3";
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** The last score the draft loop recorded for this article, if any. */
async function readBaselineScore(
  projectRoot: string,
): Promise<{ total: number; grade: string } | null> {
  const p = path.join(projectRoot, "article-review.yaml");
  if (!existsSync(p)) return null;
  try {
    const doc = parseYaml(await readFile(p, "utf8")) as {
      final_overall?: unknown;
      final_grade?: unknown;
    };
    if (typeof doc.final_overall !== "number") return null;
    return {
      total: doc.final_overall,
      grade: typeof doc.final_grade === "string" ? doc.final_grade : "?",
    };
  } catch {
    return null;
  }
}

/** The revision record — what was applied, what was skipped, what moved. */
function renderReviseYaml(record: {
  project: string;
  language: string;
  findings: { id: string; code: string; severity: string; quote: string }[];
  skipped: { source: string; id: string; reason: string }[];
  changed: string[];
  before: { total: number; grade: string } | null;
  after: { total: number; grade: string } | null;
  audit: {
    structurePreserved: boolean;
    revertedSections: number;
    revertedScenes: number;
    revertedTitle: boolean;
    revertedHook: boolean;
  };
  provider: string;
  judge: string | null;
}): string {
  const esc = (s: string): string =>
    /[:#\n{}[\],&*?|>'"%@`]/.test(s) ? JSON.stringify(s) : s;
  const lines: string[] = [
    `project: ${esc(record.project)}`,
    `language: ${esc(record.language)}`,
    `provider: ${esc(record.provider)}`,
    `judge_model: ${record.judge ?? "null"}`,
    `before_overall: ${record.before?.total ?? "null"}`,
    `before_grade: ${record.before?.grade ?? "null"}`,
    `after_overall: ${record.after?.total ?? "null"}`,
    `after_grade: ${record.after?.grade ?? "null"}`,
    `changed_passages:`,
  ];
  if (record.changed.length === 0) lines.push("  []");
  for (const c of record.changed) lines.push(`  - ${esc(c)}`);
  lines.push(`findings:`);
  for (const f of record.findings) {
    lines.push(
      `  - id: ${esc(f.id)}`,
      `    code: ${esc(f.code)}`,
      `    severity: ${esc(f.severity)}`,
      `    quote: ${esc(f.quote)}`,
    );
  }
  lines.push(`skipped:`);
  if (record.skipped.length === 0) lines.push("  []");
  for (const s of record.skipped) {
    lines.push(
      `  - source: ${esc(s.source)}`,
      `    id: ${esc(s.id)}`,
      `    reason: ${esc(s.reason)}`,
    );
  }
  lines.push(
    `audit:`,
    `  structure_preserved: ${record.audit.structurePreserved}`,
    `  reverted_sections: ${record.audit.revertedSections}`,
    `  reverted_scenes: ${record.audit.revertedScenes}`,
    `  reverted_title: ${record.audit.revertedTitle}`,
    `  reverted_hook: ${record.audit.revertedHook}`,
    "",
  );
  return lines.join("\n");
}

export async function runRevise(opts: ReviseOptions): Promise<number> {
  const resolved = resolveProjectDir(opts.project, opts.cwd);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const projectRoot = resolved.root;
  const articlePath = path.join(projectRoot, "article.md");
  if (!existsSync(articlePath)) {
    console.error(`missing ${articlePath} — run \`video draft\` first`);
    return 1;
  }

  let review: ReviewPackage;
  try {
    review = await loadReviewPackage(projectRoot);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }

  const articleMd = await readFile(articlePath, "utf8");
  let parsed;
  try {
    parsed = parseArticleWithRecovery(articleMd).article;
  } catch (err) {
    console.error(`✗ article.md is malformed: ${(err as Error).message}`);
    return 1;
  }
  const base = articleMdToRawArticle(parsed);
  if ((base.sections ?? []).length === 0) {
    console.error("✗ article.md has no numbered `## N. <heading>` sections");
    console.error(
      "  (the surgical reviser edits one section at a time — the canonical shape is required)",
    );
    return 1;
  }

  const plan = planReviewRevision(review, base);
  if (plan.findings.length === 0) {
    console.error("✗ no review finding maps to a passage in article.md");
    for (const s of plan.skipped) {
      console.error(`  - ${s.source}: ${s.reason}`);
    }
    console.error("  (edit article.md by hand, or re-run `video review`)");
    return 1;
  }

  // The article IS the storyboard's source: revising it changes an
  // approved storyboard. The guard refuses; --force overrides.
  if (
    !(await assertStageWritable(projectRoot, "storyboard", opts.force === true))
  ) {
    return 1;
  }

  const cfg = loadProviderConfig();
  const chosenName = opts.model ?? providerForRole(cfg, "research");
  const provider = providerInstance(chosenName);
  const fallbackName =
    chosenName === cfg.research.primary
      ? cfg.research.fallback
      : chosenName === cfg.research.fallback
        ? cfg.research.primary
        : undefined;
  const fallback = fallbackName ? providerInstance(fallbackName) : null;

  const judgePick = opts.judgeModel
    ? judgePickForName(opts.judgeModel, cfg)
    : pickJudgeProvider(cfg, chosenName);
  const judgeProvider = providerInstance(judgePick.name);
  const judgeFallback = judgePick.fallback
    ? providerInstance(judgePick.fallback)
    : null;

  // The topic is the film's own title — the frontmatter slug is a
  // directory name, and the reviser prompt reads this as "what is this
  // article about".
  const topic = parsed.title ?? parsed.frontmatter.project;
  const language = parsed.frontmatter.language;
  const duration = parsed.frontmatter.duration_target_sec;
  const channelProfile = parsed.frontmatter.channel_profile;

  console.log(brandBannerLine());
  console.log(
    channelHeader(opts.project, `revise · ${plan.findings.length} finding(s)`),
  );
  console.log("");
  for (const f of plan.findings) {
    console.log(
      `  ${MARK_OK} [${f.severity}] ${f.code} — ${f.description.slice(0, 100)}`,
    );
  }
  if (plan.skipped.length > 0) {
    console.log(
      `  (${plan.skipped.length} finding(s) skipped — no passage in article.md to edit)`,
    );
  }
  console.log("");

  // Improvement #3 of the draft loop, applied to review findings too: a
  // FACT_* finding (an unsupported claim) is fact-checked BEFORE the
  // reviser touches it. Without verified notes the reviser invents a
  // citation — the first real run of this command turned "余世存说过：…"
  // into "余世存在《时间之书》里写过：…", a book nobody supplied.
  const factClaims =
    opts.research === true
      ? [
          ...new Set(
            plan.findings
              .filter((f) => f.code.startsWith("FACT_"))
              .map((f) => f.quote.trim()),
          ),
        ].filter((c) => c.length > 0)
      : [];
  const notesByClaim = new Map<
    string,
    {
      claim: string;
      verdict: "supported" | "unsupported" | "unclear";
      notes: string;
    }[]
  >();
  if (factClaims.length > 0) {
    for (const claim of factClaims) {
      const notes: {
        claim: string;
        verdict: "supported" | "unsupported" | "unclear";
        notes: string;
      }[] = [];
      try {
        const out = await callResearch(
          {
            topic: claim,
            audience: "unspecified",
            language,
            duration,
          },
          provider,
          { web: new MiniMaxWebSearch(), webQuery: claim },
          fallback,
        );
        notes.push(
          ...out.output.claims.map((c) => ({
            claim: c.claim,
            verdict:
              c.status === "fact"
                ? ("supported" as const)
                : ("unclear" as const),
            notes: c.note ?? "",
          })),
        );
      } catch (err) {
        // Research must never kill the revision — degrade to no notes, so
        // the reviser softens the claim instead of citing something new.
        console.error(
          `  ! research failed for a claim (the reviser will soften it): ${(err as Error).message}`,
        );
      }
      notesByClaim.set(claim, notes);
    }
  }
  const allNotes = [...notesByClaim.values()].flat();
  const researchNotes =
    allNotes.length > 0 ? { researchNotes: allNotes } : undefined;

  // A claim with no verified note gets the rule stated on the FINDING,
  // not left to the model's discretion. The first real run of this
  // command turned "余世存说过：…" into "余世存在《时间之书》里写过：…"
  // — a book nobody supplied — because the global rule in the prompt
  // was not enough.
  const findings = plan.findings.map((f) => {
    if (!f.code.startsWith("FACT_")) return f;
    const notes = notesByClaim.get(f.quote.trim()) ?? [];
    if (notes.length > 0) return f;
    return guardUnverifiedFact(f);
  });

  let revised;
  try {
    revised = await callRevise(
      {
        base,
        baseMarkdown: articleMd,
        findings,
        ...(researchNotes !== undefined ? researchNotes : {}),
        topic,
        audience: "unspecified (not recorded in article.md)",
        language,
        duration,
        ...(channelProfile !== undefined ? { channelProfile } : {}),
      },
      provider,
      fallback,
    );
  } catch (err) {
    console.error(`✗ revision failed: ${(err as Error).message}`);
    return 1;
  }

  if (!revised.audit.structurePreserved) {
    console.error(
      "✗ the revision changed the article structure — nothing written",
    );
    console.error("  (the reviser must keep the same sections and scenes)");
    return 1;
  }

  const patch = applyRevisionToMarkdown(articleMd, base, revised.raw);
  if (patch.markdown === articleMd) {
    console.error("✗ the revision changed nothing — nothing written");
    return 1;
  }

  // The patched file must still parse — a broken article.md is worse
  // than an unrevised one.
  try {
    parseArticleWithRecovery(patch.markdown);
  } catch (err) {
    console.error(
      `✗ the revised article.md would not parse: ${(err as Error).message}`,
    );
    console.error("  (nothing written)");
    return 1;
  }

  await writeFile(articlePath, patch.markdown, "utf8");

  // The storyboard is derived from article.md — refresh it so the next
  // `video make` does not render the pre-revision scenes. The shared
  // sync keeps the motion plan and the hand edits; a raw re-derivation
  // would drop both.
  try {
    const { syncStoryboardFromArticle } = await import("@video/make");
    const { article } = parseArticleWithRecovery(patch.markdown);
    const notes = await syncStoryboardFromArticle(projectRoot, article);
    for (const note of notes) console.log(`  ${note}`);
  } catch (err) {
    console.error(
      `  ! could not refresh storyboard.yaml: ${(err as Error).message}`,
    );
  }

  // Re-evaluate: the article judge scores the revised article so the
  // revision reports a movement, not just a diff.
  const before = await readBaselineScore(projectRoot);
  let after: { total: number; grade: string } | null = null;
  let judgeName: string | null = null;
  if (opts.noJudge !== true) {
    try {
      const score: ArticleScore = await scoreArticle(
        patch.markdown,
        judgeProvider,
        judgeFallback,
        channelProfile,
        {
          topic,
          language,
          durationSec: duration,
        },
      );
      after = {
        total: score.computed.overall_score,
        grade: score.computed.grade,
      };
      judgeName = score.judge?.providerName ?? judgePick.name;
    } catch (err) {
      console.error(
        `  ! article judge failed after the revision: ${(err as Error).message}`,
      );
    }
  }

  const recordPath = path.join(projectRoot, "article-revise.yaml");
  await writeFile(
    recordPath,
    renderReviseYaml({
      project: path.basename(projectRoot),
      language,
      findings: plan.findings.map((f) => ({
        id: f.id,
        code: f.code,
        severity: f.severity,
        quote: f.quote,
      })),
      skipped: plan.skipped,
      changed: patch.changed,
      before,
      after,
      audit: revised.audit,
      provider: revised.providerName,
      judge: judgeName,
    }),
    "utf8",
  );

  // Optional: close the loop on the review side too — the revised film
  // gets a fresh review, so the next round starts from fresh findings.
  if (opts.reReview === true) {
    try {
      const artifacts = await collectReviewArtifacts(projectRoot);
      const result = await callReview(
        {
          storyboard: artifacts.storyboard,
          script: artifacts.script,
          claims: artifacts.claims,
        },
        judgeProvider,
        judgeFallback,
      );
      await mkdir(path.join(projectRoot, "review"), { recursive: true });
      await writeFile(
        path.join(projectRoot, "review", "content-review.yaml"),
        stringifyYaml({ content: result.review.content }),
        "utf8",
      );
      await writeFile(
        path.join(projectRoot, "review", "visual-review.yaml"),
        stringifyYaml({ visual: result.review.visual }),
        "utf8",
      );
      await writeFile(
        path.join(projectRoot, "review", "technical-review.yaml"),
        stringifyYaml({ technical: result.review.technical }),
        "utf8",
      );
      console.log(`${MARK_OK} re-reviewed → review/*.yaml`);
    } catch (err) {
      console.error(`  ! re-review failed: ${(err as Error).message}`);
    }
  }

  const runId = formatRunId("revise");
  await writeRun(projectRoot, {
    run_id: runId,
    stage: "revise",
    status: "succeeded",
    actor: "agent",
    tool: "video-revise",
    input_commit: safeGitHead(projectRoot),
    input_files: ["article.md", "review/content-review.yaml"],
    output_files: ["article.md", "article-revise.yaml"],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: revised.providerName,
    model: modelFor(revised.providerName),
    tokens: revised.usage,
    estimated_cost_usd:
      (revised.usage.input / 1000) *
        (revised.providerName === "glm" ? 0.0008 : 0.001) +
      (revised.usage.output / 1000) *
        (revised.providerName === "glm" ? 0.0008 : 0.001),
  });

  console.log(`${MARK_OK} revised ${articlePath}`);
  console.log(
    `  changed: ${patch.changed.length > 0 ? patch.changed.join(", ") : "nothing"}`,
  );
  console.log(
    `  provider=${revised.providerName}  tokens=${revised.usage.input}+${revised.usage.output}`,
  );
  if (after !== null) {
    const delta =
      before === null
        ? `score ${after.total}/100 (${after.grade})`
        : `score ${before.total} → ${after.total}/100 (${before.grade} → ${after.grade})`;
    console.log(`  ${delta}`);
  }
  console.log(`  record → ${recordPath}`);
  return 0;
}

export function registerRevise(program: Command): void {
  program
    .command("revise")
    .argument(
      "<project>",
      "project to revise: topic, folder name, path, or unique prefix",
    )
    .option("--cwd <dir>", "base directory for the project")
    .option(
      "--model <provider>",
      "model provider for the revision: minimax|glm (default: research role)",
    )
    .option(
      "--judge-model <provider>",
      "model provider that re-scores the revision: minimax|glm",
    )
    .option("--no-judge", "apply the revision without re-scoring it")
    .option("--re-review", "re-run `video review` on the revised project")
    .option(
      "--research",
      "fact-check the FACT_* claims before the reviser touches them (slow: one research call per claim)",
    )
    .option("--force", "revise even when the storyboard checkpoint is approved")
    .action(
      async (
        project: string,
        opts: {
          cwd?: string;
          model?: "minimax" | "glm";
          judgeModel?: "minimax" | "glm";
          judge?: boolean;
          reReview?: boolean;
          research?: boolean;
          force?: boolean;
        },
      ) => {
        process.exitCode = await runRevise({
          project,
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.model !== undefined ? { model: opts.model } : {}),
          ...(opts.judgeModel !== undefined
            ? { judgeModel: opts.judgeModel }
            : {}),
          ...(opts.judge === false ? { noJudge: true } : {}),
          ...(opts.reReview !== undefined ? { reReview: opts.reReview } : {}),
          ...(opts.research !== undefined ? { research: opts.research } : {}),
          ...(opts.force !== undefined ? { force: opts.force } : {}),
        });
      },
    );
}
