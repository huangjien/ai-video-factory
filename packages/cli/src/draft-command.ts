import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  GLMProvider,
  MiniMaxProvider,
  loadProviderConfig,
  providerForRole,
  type Provider,
} from "@video/llm";
import { MiniMaxWebSearch } from "@video/research";
import {
  articleToStoryboardYaml,
  callDraft,
  parseArticleWithRecovery,
  renderArticleReviewYaml,
  runScoredDraft,
  type ParsedArticle,
} from "@video/draft";
import { callAudioPlan, type AudioConfig } from "@video/audio-plan";
import { resolveProjectDir } from "./project-path.js";

export interface DraftOptions {
  topic: string;
  cwd?: string;
  model?: "minimax" | "glm";
  lang?: "zh-CN" | "en-US";
  duration?: number;
  audience?: string;
  /** Path to a file containing pre-existing content to revise. */
  from?: string;
  /** Path to a text/markdown file holding the user's raw idea — the LLM
   *  polishes it into the article but must not change its opinions. */
  ideaFile?: string;
  noWeb?: boolean;
  /** Skip the merged audio-plan step (article.md only). */
  noAudioPlan?: boolean;
  /** v0.4 (T8): override the storyboard visual theme. Stamped into the
   *  article frontmatter so articleToStoryboardYaml emits
   *  `style.theme: <theme>` instead of the hardcoded "dark-tech". */
  style?: string;
  /** v0.4 (T1): when true, the auto-generated storyboard omits the
   *  `captions: { source: narration }` block (render-time caption
   *  overlay is skipped). */
  noCaptions?: boolean;
  /** Quality gate (2026-10-03): after each draft, an LLM judge rates the
   *  article attractive/interesting/useful (0-10 each). Below `minScore`
   *  the draft is regenerated with the judge's feedback, up to
   *  `maxAttempts` drafts total; the best-scoring candidate wins.
   *  Disable with --no-review. */
  noReview?: boolean;
  /** Acceptance bar of the article review loop, of 30. Default 25. */
  minScore?: number;
  /** Total draft attempts in the review loop (not extra retries). Default 3. */
  maxAttempts?: number;
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unsupported provider: ${name}`);
}

export type AudioPlanStep =
  | { status: "written"; config: AudioConfig; tokens: { input: number; output: number } }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

/** Merged audio-plan step of `video draft`: write audio-config.yaml from
 *  the freshly drafted article. Keeps an existing audio-config.yaml
 *  (hand edits are a human checkpoint — regenerate explicitly via
 *  `video audio-plan`); an LLM failure degrades to a hint instead of
 *  failing the draft, whose primary artifact is article.md. */
export async function writeAudioConfigIfAbsent(
  projectRoot: string,
  article: ParsedArticle,
  provider: Provider,
  fallback: Provider | null,
  opts: { skip?: boolean } = {},
): Promise<AudioPlanStep> {
  const outPath = path.join(projectRoot, "audio-config.yaml");
  if (opts.skip) {
    return { status: "skipped", reason: "--no-audio-plan" };
  }
  if (existsSync(outPath)) {
    return { status: "skipped", reason: "exists" };
  }
  try {
    const { config, yaml, usage } = await callAudioPlan(
      { article, language: article.frontmatter.language },
      provider,
      fallback,
    );
    await writeFile(outPath, yaml, "utf8");
    return { status: "written", config, tokens: usage };
  } catch (err) {
    return { status: "failed", error: (err as Error).message };
  }
}

export async function runDraft(opts: DraftOptions): Promise<number> {
  // Validate input flags before project lookup so the user sees the
  // most useful error first (no point telling them the project is
  // missing when their flags are already wrong).
  if (opts.ideaFile !== undefined && opts.from !== undefined) {
    console.error(`--file and --from are mutually exclusive:`);
    console.error(`  --file <path>  your raw idea (polished, opinions preserved)`);
    console.error(`  --from <path>  an existing article to revise`);
    return 1;
  }
  let fromContent: string | undefined;
  if (opts.from) {
    const fromPath = path.resolve(opts.from);
    if (!existsSync(fromPath)) {
      console.error(`--from file not found: ${fromPath}`);
      return 1;
    }
    fromContent = await readFile(fromPath, "utf8");
  }
  let ideaSeed: string | undefined;
  if (opts.ideaFile) {
    const ideaPath = path.resolve(opts.ideaFile);
    if (!existsSync(ideaPath)) {
      console.error(`--file not found: ${ideaPath}`);
      return 1;
    }
    ideaSeed = await readFile(ideaPath, "utf8");
    if (ideaSeed.trim().length === 0) {
      console.error(`--file is empty: ${ideaPath}`);
      return 1;
    }
  }

  const resolvedProject = resolveProjectDir(opts.topic, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    console.error(`hint: scaffold it with \`video new <topic>\` first, then re-run`);
    return 1;
  }
  const projectRoot = resolvedProject.root;

  const cfg = loadProviderConfig();
  const chosenName = opts.model ?? providerForRole(cfg, "research");
  const provider = providerInstance(chosenName);
  // Per-config fallback (minimax → glm or vice versa). When the chosen
  // provider returns a quota / rate-limit error, `callDraft` retries
  // with the fallback once instead of failing the whole run.
  const fallbackName =
    chosenName === cfg.research.primary
      ? cfg.research.fallback
      : chosenName === cfg.research.fallback
        ? cfg.research.primary
        : undefined;
  const fallback = fallbackName ? providerInstance(fallbackName) : null;
  const language = opts.lang ?? "zh-CN";
  const duration = opts.duration ?? 40;
  const audience = opts.audience ?? "developers";

  let webContext:
    | { url: string; title: string; snippet: string }[]
    | undefined;
  if (!opts.noWeb) {
    try {
      webContext = await new MiniMaxWebSearch().search(opts.topic);
    } catch {
      webContext = undefined;
    }
  }

  const draftInput = {
    topic: opts.topic,
    audience,
    language,
    duration,
    ...(fromContent !== undefined ? { fromContent } : {}),
    ...(ideaSeed !== undefined ? { ideaSeed } : {}),
    ...(webContext && webContext.length > 0 ? { webContext } : {}),
  };

  let markdown: string;
  let usage: { input: number; output: number };
  let servedBy: string;
  if (opts.noReview === true) {
    ({ markdown, usage, providerName: servedBy } = await callDraft(
      draftInput,
      provider,
      fallback,
    ));
  } else {
    const minScore = opts.minScore ?? 25;
    const maxAttempts = opts.maxAttempts ?? 3;
    const result = await runScoredDraft(draftInput, provider, fallback, {
      minScore,
      maxAttempts,
      onAttempt: (a, total) => {
        if (a.score) {
          const s = a.score;
          const verdict = a.passing
            ? "✓ above bar"
            : a.attempt < total
              ? `→ below ${minScore}, regenerating with judge feedback`
              : `→ still below ${minScore} after ${total} attempts`;
          console.log(
            `  review ${a.attempt}/${total}: attractive=${s.attractive} interesting=${s.interesting} useful=${s.useful} → ${s.total}/30  ${verdict}`,
          );
        } else {
          console.error(
            `  ! article judge failed (attempt ${a.attempt}): ${(a.scoreError ?? "").slice(0, 140)}`,
          );
          console.error("  (keeping this draft unreviewed)");
        }
      },
    });
    markdown = result.markdown;
    usage = result.usage;
    servedBy = result.providerName;
    if (result.regenerated && result.score) {
      console.log(
        `  kept attempt ${result.attempts.findIndex((a) => a.markdown === result.markdown) + 1} — best of ${result.attempts.length}`,
      );
    }
    if (!result.passing && result.score) {
      console.error(
        `  ! best draft scored ${result.score.total}/30 (bar: ${minScore}) — edit article.md or raise --max-attempts / lower --min-score`,
      );
    }
    const reviewPath = path.join(projectRoot, "article-review.yaml");
    await writeFile(
      reviewPath,
      renderArticleReviewYaml(result, {
        project: path.basename(projectRoot),
        threshold: minScore,
        language,
      }),
      "utf8",
    );
    console.log(`✓ article review → ${reviewPath}`);
  }

  const articlePath = path.join(projectRoot, "article.md");
  await mkdir(path.dirname(articlePath), { recursive: true });
  await writeFile(articlePath, markdown, "utf8");

  let parsedArticle: ParsedArticle | null = null;
  try {
    const { article, recoveredCount } = parseArticleWithRecovery(markdown);
    parsedArticle = article;
    if (recoveredCount > 0) {
      console.error(
        `  ! draft shipped ${recoveredCount} empty scene narrations — recovered from section bodies.`,
      );
      console.error(
        `  (edit the narrations in article.md, or re-run with --from to revise)`,
      );
    }
    const storyboardPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
    // v0.4 (T1 + T8): stamp CLI-supplied knobs onto the parsed article
    // before handing it to the storyboard mapper. We only mutate the
    // in-memory copy; the article.md on disk stays as the LLM wrote it
    // so the human-edit invariant (`article.md` is the canonical source)
    // is preserved.
    if (opts.style !== undefined || opts.noCaptions === true) {
      article.frontmatter = {
        ...article.frontmatter,
        ...(opts.style !== undefined ? { theme: opts.style } : {}),
        ...(opts.noCaptions === true ? { no_captions: true } : {}),
      };
    }
    await writeFile(storyboardPath, articleToStoryboardYaml(article), "utf8");
  } catch (err) {
    console.error(
      `  ! could not refresh storyboard.yaml from article.md: ${(err as Error).message}`,
    );
    console.error(
      "  (article.md was written; render will still use the existing storyboard.yaml)",
    );
  }

  console.log(`✓ drafted ${articlePath}`);
  console.log(`  model=${servedBy}  tokens=${usage.input}+${usage.output}`);

  let audioPlanHint: string;
  if (parsedArticle === null) {
    audioPlanHint = `edit article.md to refine the narrative, then \`video audio-plan <topic>\``;
  } else {
    const step = await writeAudioConfigIfAbsent(
      projectRoot,
      parsedArticle,
      provider,
      fallback,
      { skip: opts.noAudioPlan === true },
    );
    if (step.status === "written") {
      const sfxCount = Object.keys(step.config.sfx ?? {}).length;
      console.log(`✓ drafted ${path.join(projectRoot, "audio-config.yaml")}`);
      console.log(
        `  voice=${step.config.voice ?? "(default)"}  bgm=${step.config.bgm ?? "(none)"}  sfx=${sfxCount}  tokens=${step.tokens.input}+${step.tokens.output}`,
      );
      audioPlanHint = `edit article.md / audio-config.yaml, then \`video make ${opts.topic}\``;
    } else if (step.status === "skipped" && step.reason === "exists") {
      console.log(
        `  audio-config.yaml exists — kept (hand edits win); re-run \`video audio-plan\` to regenerate`,
      );
      audioPlanHint = `edit article.md / audio-config.yaml, then \`video make ${opts.topic}\``;
    } else if (step.status === "skipped") {
      audioPlanHint = `edit article.md to refine the narrative, then \`video audio-plan <topic>\``;
    } else {
      console.error(`  ! audio-plan step failed: ${step.error.slice(0, 120)}`);
      console.error(`  (article.md was written; run \`video audio-plan\` separately)`);
      audioPlanHint = `edit article.md to refine the narrative, then \`video audio-plan <topic>\``;
    }
  }
  console.log(`  next: ${audioPlanHint}`);
  return 0;
}
