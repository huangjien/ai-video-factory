import type { Command } from "commander";
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
  DEFAULT_MIN_SCORE,
  parseArticleWithRecovery,
  renderArticleReviewYaml,
  resolveImageStyle,
  runScoredDraft,
  type ParsedArticle,
} from "@video/draft";
import {
  callAudioPlan,
  renderAudioConfig,
  type AudioConfig,
} from "@video/audio-plan";
import { DEFAULT_THEME_NAME } from "@video/theme";
import { resolveProjectDir } from "./project-path.js";
import { withProgress } from "./ui.js";
import {
  maybeAgentAsk,
  resolveAskTrigger,
  detectAgentEnv,
  type AskCtx,
} from "./agent-ask.js";
import { voiceboxStatus, parseTtsChoice } from "@video/tts";

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
  /** v0.7 (video-ask/1): BGM track tag stamped into a freshly written
   *  audio-config.yaml (`none` → bgm: null). Only the bgm key is
   *  overridden — voice and SFX stay as the audio-plan LLM chose. An
   *  existing audio-config.yaml wins (hand edits are a human
   *  checkpoint): the answer is not applied and a warning is printed. */
  bgm?: string;
  /** v0.4 (T8): override the storyboard visual theme. Stamped into the
   *  article frontmatter so articleToStoryboardYaml emits
   *  `style.theme: <theme>` instead of the hardcoded "dark-tech". */
  style?: string;
  /** v0.6: image-style preset for generated scene visuals — written into the
   *  article.md frontmatter (`image_style:`) so `video make` picks it
   *  up. flat-vector (default), photoreal, watercolor, ink-wash, clay-3d,
   *  manga, genki-anime, medieval, editorial, whiteboard, isometric,
   *  paper-cut. Also a
   *  video-ask/1 knob (v0.7): passing it explicitly marks the
   *  image_style question as specified for the agent-ask gate
   *  (docs/v0.7-agent-ask-protocol-plan.md §5–§6). */
  imageStyle?: string;
  /** Scene-image provider — written into the article.md frontmatter
   *  (`image_provider:`) so `video make` picks it up. minimax (default)
   *  | openai | gemini | mock | none. Also a video-ask/1 knob: passing
   *  it explicitly marks the image_provider question as specified. */
  imageProvider?: string;
  /** CS-01: channel grammar profile stamped into article.md frontmatter
   *  (`channel_profile:`) and carried to storyboard `style.channel_profile`
   *  → VDSL → RenderPlan.style. Distinct from `imageStyle`, which is the
   *  per-film art style. */
  channelProfile?: string;
  /** Narration backend — written into article.md frontmatter
   *  (`tts_provider:` + `voice:`) so `video make` picks it up.
   *  voicebox:<profile> | minimax-system | edge. Also a video-ask/1
   *  knob (conditional: only offered when the local voicebox server
   *  answers with cloned profiles). */
  tts?: string;
  /** v0.7 (video-ask/1): force the agent-ask gate — emit the
   *  video-ask/1 question envelope and exit 2 even when no agent
   *  harness is detected. See docs/v0.7-agent-ask-protocol-plan.md §4. */
  ask?: boolean;
  /** v0.7 (video-ask/1): never ask — accept silent defaults even under
   *  an agent harness. Beats --ask and VIDEO_ASK (spec §4 precedence). */
  noAsk?: boolean;
  /** v0.4 (T1): when true, the auto-generated storyboard omits the
   *  `captions: { source: narration }` block (render-time caption
   *  overlay is skipped). */
  noCaptions?: boolean;
  /** Quality gate (2026-10-03, refined 2026-11): after each draft, an LLM
   *  judge rates the article across 8 dimensions × 24 indicators on the
   *  `general_article_v1` profile. Below `minScore` (or when a Critical
   *  finding sits in `risk_flags`) the draft is regenerated with the
   *  judge's feedback, up to `maxAttempts` drafts total; the
   *  best-scoring candidate wins. Disable with --no-review. */
  noReview?: boolean;
  /** Acceptance bar of the article review loop, of 100. Default 70
   *  (C grade on the framework's bands). A Critical finding always
   *  blocks regardless of this number. */
  minScore?: number;
  /** Total draft attempts in the review loop (not extra retries). Default 3. */
  maxAttempts?: number;
  /** Parallel best-of-N candidates per review round (default 1 = serial).
   *  N > 1 spends N× draft+judge tokens per round and caps wall time at
   *  one round's generation. */
  candidates?: number;
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unsupported provider: ${name}`);
}

/** Insert `key: value` into the article's frontmatter block (replace in
 *  place when the key exists). No-op when there is no frontmatter. */
export function stampFrontmatterKey(
  markdown: string,
  key: string,
  value: string,
): string {
  if (!markdown.startsWith("---")) return markdown;
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return markdown;
  const head = markdown.slice(0, end);
  const rest = markdown.slice(end);
  const re = new RegExp(`^${key}:.*$`, "m");
  if (re.test(head)) return head.replace(re, `${key}: ${value}`) + rest;
  return `${head}\n${key}: ${value}${rest}`;
}

/** Frontmatter keys the drafter owns: they describe THIS run and must always
 *  reflect the new draft, never be carried over from the old one. */
const DRAFT_OWNED_FRONTMATTER = [
  "project",
  "language",
  "duration_target_sec",
  "voice",
] as const;

/**
 * Carry forward durable config keys from the previous article into the new
 * one (v0.10).
 *
 * `renderArticleMd` builds a fresh four-key frontmatter on every run, and
 * `runDraft` writes it over the existing file without reading it first. So any
 * key a human set by hand — `setting:` above all — silently vanished on the
 * next `video draft`, along with `image_style` / `image_provider` whenever
 * their flags were omitted. An era fix that does not survive a re-draft is not
 * a fix.
 *
 * Only keys absent from `next` are copied; an explicit value always wins, and
 * `stampFrontmatterKey` still overrides afterwards.
 */
export function preserveFrontmatterKeys(
  next: string,
  prev: string | null,
): string {
  if (prev === null) return next;
  if (!prev.startsWith("---") || !next.startsWith("---")) return next;
  const prevEnd = prev.indexOf("\n---", 3);
  const nextEnd = next.indexOf("\n---", 3);
  if (prevEnd === -1 || nextEnd === -1) return next;
  const prevHead = prev.slice(0, prevEnd);
  const nextHead = next.slice(0, nextEnd);

  const present = new Set(
    nextHead
      .split("\n")
      .map((line) => /^([A-Za-z_][A-Za-z0-9_]*):/.exec(line)?.[1])
      .filter((k): k is string => k !== undefined),
  );
  const carried = prevHead
    .split("\n")
    .filter((line) => {
      const key = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(line)?.[1];
      if (key === undefined) return false;
      if (present.has(key)) return false;
      return !(DRAFT_OWNED_FRONTMATTER as readonly string[]).includes(key);
    })
    .map((line) => line.trimEnd());
  if (carried.length === 0) return next;
  return `${nextHead}\n${carried.join("\n")}${next.slice(nextEnd)}`;
}

export type AudioPlanStep =
  | {
      status: "written";
      config: AudioConfig;
      tokens: { input: number; output: number };
    }
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
  opts: { skip?: boolean; bgm?: string } = {},
): Promise<AudioPlanStep> {
  const outPath = path.join(projectRoot, "audio-config.yaml");
  if (opts.skip) {
    return { status: "skipped", reason: "--no-audio-plan" };
  }
  if (existsSync(outPath)) {
    return { status: "skipped", reason: "exists" };
  }
  try {
    const { config, yaml, usage } = await withProgress("audio-plan", () =>
      callAudioPlan(
        { article, language: article.frontmatter.language },
        provider,
        fallback,
      ),
    );
    // v0.7 (--bgm): stamp the answered tag over the audio-plan LLM's
    // pick for the `bgm:` key ONLY (voice and sfx stay LLM-chosen);
    // `none` → bgm: null. Re-rendered with the package's own
    // serializer so every other line (incl. fade keys) is untouched.
    let outYaml = yaml;
    let outConfig = config;
    if (opts.bgm !== undefined) {
      outConfig = { ...config, bgm: opts.bgm === "none" ? null : opts.bgm };
      outYaml = renderAudioConfig(outConfig);
    }
    await writeFile(outPath, outYaml, "utf8");
    return { status: "written", config: outConfig, tokens: usage };
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
    console.error(
      `  --file <path>  your raw idea (polished, opinions preserved)`,
    );
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

  // v0.7 (video-ask/1): the ask gate sits before provider config /
  // project resolution / web search, so the exit-2 path constructs no
  // provider and writes no file (spec §4). null = run normally.
  // The tts question is conditional on a healthy local voicebox — probe
  // here (the ask module stays I/O-free). Humans never pay the probe:
  // it only runs when the gate could actually ask.
  let askCtx: AskCtx | undefined;
  const askTrigger = resolveAskTrigger(opts);
  if (
    askTrigger.mode !== "off" &&
    (askTrigger.mode === "force" || detectAgentEnv())
  ) {
    const status = await voiceboxStatus();
    if (status.healthy && status.profiles.length > 0) {
      askCtx = { voiceboxProfiles: status.profiles };
    }
  }
  const askExit = await maybeAgentAsk(opts, process.argv, askCtx);
  if (askExit !== null) {
    // No process.exitCode here: callers get the code from the return
    // value (the commander action assigns it; a sticky write here would
    // leak the exit code into unrelated library callers' processes).
    return askExit;
  }
  const resolvedProject = resolveProjectDir(opts.topic, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    console.error(
      `hint: scaffold it with \`video new <topic>\` first, then re-run`,
    );
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
  const duration = opts.duration ?? 180;
  const audience = opts.audience ?? "developers";

  let webContext: { url: string; title: string; snippet: string }[] | undefined;
  if (!opts.noWeb) {
    try {
      webContext = await withProgress("web search", () =>
        new MiniMaxWebSearch().search(opts.topic),
      );
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
    ...(opts.channelProfile !== undefined
      ? { channelProfile: opts.channelProfile }
      : {}),
  };

  let markdown: string;
  let usage: { input: number; output: number };
  let servedBy: string;
  if (opts.noReview === true) {
    ({
      markdown,
      usage,
      providerName: servedBy,
    } = await withProgress(`drafting article (${chosenName})`, () =>
      callDraft(draftInput, provider, fallback),
    ));
  } else {
    const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
    const maxAttempts = opts.maxAttempts ?? 8;
    const result = await withProgress(
      `drafting article (${chosenName}, judged)`,
      async () => {
        return await runScoredDraft(draftInput, provider, fallback, {
          minScore,
          maxAttempts,
          ...(opts.candidates !== undefined
            ? { candidates: opts.candidates }
            : {}),
          onAttempt: (a, total) => {
            if (a.score) {
              const s = a.score;
              const verdict = a.passing
                ? "✓ above bar"
                : a.attempt < total
                  ? `→ below ${minScore}, regenerating with judge feedback`
                  : `→ still below ${minScore} after ${total} attempts`;
              const blockers = s.raw.risk_flags.filter(
                (r) => r.severity === "Critical",
              );
              const blockerNote =
                blockers.length > 0
                  ? ` [blocker: ${blockers.map((r) => r.code).join(", ")}]`
                  : "";
              console.log(
                `  review ${a.attempt}/${total}: overall=${s.computed.overall_score} grade=${s.computed.grade} coverage=${s.computed.coverage}% → ${s.total}/100${blockerNote}  ${verdict}`,
              );
            } else {
              console.error(
                `  ! article judge failed (attempt ${a.attempt}): ${(a.scoreError ?? "").slice(0, 140)}`,
              );
              console.error("  (keeping this draft unreviewed)");
            }
          },
        });
      },
    );
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
        `  ! best draft scored ${result.score.total}/100 grade ${result.score.computed.grade} (bar: ${minScore}) — edit article.md or raise --max-attempts / lower --min-score`,
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
  // v0.10: read the outgoing article first so durable config a human set by
  // hand (notably `setting:`) survives this re-draft.
  let previousArticle: string | null = null;
  try {
    previousArticle = await readFile(articlePath, "utf8");
  } catch {
    previousArticle = null; // first draft for this project
  }
  markdown = preserveFrontmatterKeys(markdown, previousArticle);
  // v0.6: `--image-style` is written INTO article.md frontmatter — the
  // human-editable single source `video make` reads. (Unlike --style,
  // which only affects this run's storyboard write.)
  const imageStyle = resolveImageStyle(opts.imageStyle);
  let stamped = opts.imageStyle
    ? stampFrontmatterKey(markdown, "image_style", imageStyle)
    : markdown;
  // Same contract as image_style: the provider choice is durable project
  // config, so it belongs in article.md where `video make` reads it — not
  // in a one-shot draft flag.
  if (opts.imageProvider !== undefined) {
    stamped = stampFrontmatterKey(
      stamped,
      "image_provider",
      opts.imageProvider,
    );
  }
  // CS-01: same contract. channel_profile outlives image_style by design —
  // it is the cross-film channel grammar, so changing the art style must
  // not clear it.
  if (opts.channelProfile !== undefined) {
    stamped = stampFrontmatterKey(
      stamped,
      "channel_profile",
      opts.channelProfile,
    );
  }
  // Same contract as image_provider: the narration backend is durable
  // project config (tts_provider + voice), and --tts / the video-ask
  // answer is the explicit value that always wins.
  if (opts.tts !== undefined) {
    const { ttsProvider, voice } = parseTtsChoice(opts.tts, language);
    stamped = stampFrontmatterKey(stamped, "tts_provider", ttsProvider);
    if (voice !== undefined) {
      stamped = stampFrontmatterKey(stamped, "voice", voice);
    }
  }
  await writeFile(articlePath, stamped, "utf8");

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
    const storyboardPath = path.join(
      projectRoot,
      "storyboard",
      "storyboard.yaml",
    );
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
    await writeFile(
      storyboardPath,
      articleToStoryboardYaml(article),
      "utf8",
    );
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
      {
        skip: opts.noAudioPlan === true,
        ...(opts.bgm !== undefined ? { bgm: opts.bgm } : {}),
      },
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
      // v0.7 (--bgm): the answer cannot be applied to a kept config —
      // say so instead of silently dropping it (spec §6, verbatim).
      if (opts.bgm !== undefined) {
        console.error(
          `bgm answer not applied — audio-config.yaml kept; run 'video audio-plan' to regenerate`,
        );
      }
      audioPlanHint = `edit article.md / audio-config.yaml, then \`video make ${opts.topic}\``;
    } else if (step.status === "skipped") {
      audioPlanHint = `edit article.md to refine the narrative, then \`video audio-plan <topic>\``;
    } else {
      console.error(`  ! audio-plan step failed: ${step.error.slice(0, 120)}`);
      console.error(
        `  (article.md was written; run \`video audio-plan\` separately)`,
      );
      audioPlanHint = `edit article.md to refine the narrative, then \`video audio-plan <topic>\``;
    }
  }
  console.log(`  next: ${audioPlanHint}`);
  return 0;
}

/** Commander's parse result for the `draft` options — the opts object
 *  handed to the action. Note commander never produces a `noAsk` key:
 *  `--no-ask` arrives folded into `ask: false`. */
export interface DraftCliOpts {
  cwd?: string;
  model?: "minimax" | "glm";
  web?: boolean;
  lang?: "zh-CN" | "en-US";
  duration?: number;
  audience?: string;
  bgm?: string;
  from?: string;
  file?: string;
  audioPlan?: boolean;
  imageStyle?: string;
  imageProvider?: string;
  channelProfile?: string;
  tts?: string;
  style?: string;
  captions?: boolean;
  review?: boolean;
  minScore?: number;
  maxAttempts?: number;
  ask?: boolean;
}

/** Map the commander parse result onto runDraft's DraftOptions (topic
 *  comes separately from the positional argument). Pure so the
 *  `--ask`/`--no-ask` folding is testable at parse level — before, the
 *  real CLI was the only place this mapping ran (spec §4 precedence,
 *  §8 rule 6). */
export function draftCliOptsToDraftOptions(
  opts: DraftCliOpts,
): Omit<DraftOptions, "topic"> {
  return {
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    noWeb: opts.web === false,
    ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
    ...(opts.duration !== undefined ? { duration: opts.duration } : {}),
    ...(opts.audience !== undefined ? { audience: opts.audience } : {}),
    ...(opts.bgm !== undefined ? { bgm: opts.bgm } : {}),
    ...(opts.from !== undefined ? { from: opts.from } : {}),
    ...(opts.file !== undefined ? { ideaFile: opts.file } : {}),
    noAudioPlan: opts.audioPlan === false,
    ...(opts.imageStyle !== undefined ? { imageStyle: opts.imageStyle } : {}),
    ...(opts.imageProvider !== undefined
      ? { imageProvider: opts.imageProvider }
      : {}),
    ...(opts.channelProfile !== undefined
      ? { channelProfile: opts.channelProfile }
      : {}),
    ...(opts.tts !== undefined ? { tts: opts.tts } : {}),
    ...(opts.style !== undefined ? { style: opts.style } : {}),
    noCaptions: opts.captions === false,
    noReview: opts.review === false,
    ...(opts.minScore !== undefined ? { minScore: opts.minScore } : {}),
    ...(opts.maxAttempts !== undefined
      ? { maxAttempts: opts.maxAttempts }
      : {}),
    // commander folds `--ask`/`--no-ask` into a single `ask` boolean
    // (never a `noAsk` key): `false` means the user passed `--no-ask`
    // and must reach the gate as `noAsk` (spec §4 precedence — no-ask
    // beats --ask and VIDEO_ASK).
    ...(opts.ask === true ? { ask: true } : {}),
    ...(opts.ask === false ? { noAsk: true } : {}),
  };
}

export function registerDraft(program: Command): void {
  program
    .command("draft")
    .argument(
      "<topic>",
      "topic — used as project slug (slugify the topic for the directory name)",
    )
    .option("--cwd <dir>", "base directory for the project")
    .option("--model <provider>", "model provider: minimax|glm (default: glm)")
    .option("--no-web", "disable MiniMax web search (use LLM knowledge only)")
    .option("--lang <lang>", "language: zh-CN|en-US (default zh-CN)")
    .option(
      "--tts <choice>",
      "narration backend stamped into article.md: voicebox:<profile> | minimax-system | edge (voice-ask knob; offered automatically when the local voicebox server is up)",
    )
    .option(
      "--duration <seconds>",
      "total duration target in seconds (default: 180)",
      (v) => parseInt(v, 10),
    )
    .option("--audience <text>", "target audience (default: developers)")
    .option(
      "--bgm <tag>",
      "BGM track tag from the library in assets/bgm/ (e.g. upbeat-your-love, light-gravity, classical-gymnopedie-no-3), or none for silence. Default: the audio planner picks from the catalogue. See assets/bgm/README.md",
    )
    .option(
      "--from <file>",
      "path to a file containing pre-existing content to revise",
    )
    .option(
      "--file <path>",
      "path to a text/markdown file holding your raw idea — polished into the article, opinions preserved",
    )
    .option(
      "--no-audio-plan",
      "skip the merged audio-plan step (write article.md only)",
    )
    .option(
      "--image-style <style>",
      "scene-image style preset — flat-vector | photoreal | watercolor | ink-wash | clay-3d | manga | genki-anime | medieval | editorial | whiteboard | isometric | paper-cut | gongbi (default: flat-vector); see video prompts show image-styles.yaml for use cases",
    )
    .option(
      "--image-provider <provider>",
      "scene-image provider stamped into article.md frontmatter: minimax (default; needs MINIMAX_API_KEY) | openai | gemini | mock | none (v0.7: also an agent-ask knob, video-ask/1)",
      (v) => {
        const allowed = ["minimax", "openai", "gemini", "mock", "none"];
        if (!allowed.includes(v)) {
          throw new Error(
            `--image-provider must be ${allowed.join("|")}, got: ${v}`,
          );
        }
        return v;
      },
    )
    .option(
      "--channel-profile <name>",
      "v0.11: cross-video channel grammar profile stamped into article.md frontmatter and carried to the render plan (currently: chinese-storybook). Distinct from --image-style, which is the per-film art style.",
    )
    .option(
      "--style <theme>",
      `v0.4: visual theme written into storyboard.style.theme (default: ${DEFAULT_THEME_NAME})`,
    )
    .option(
      "--no-captions",
      "v0.4: skip the caption overlay (no captions: block in the generated storyboard)",
    )
    .option(
      "--no-review",
      "skip the article quality gate (default: an LLM judge scores 8 dimensions × 24 indicators on a 0-100 weighted scale; drafts below the bar or with Critical risk flags are regenerated with the judge's feedback)",
    )
    .option(
      "--min-score <n>",
      "article quality bar on the 0-100 weighted score (default: 90 = grade A; Critical risk flags fail regardless of score)",
      (v) => parseInt(v, 10),
    )
    .option(
      "--max-attempts <n>",
      "total draft attempts in the quality loop (default: 8; the top-scoring candidate is kept regardless of passing)",
      (v) => parseInt(v, 10),
    )
    .option(
      "--candidates <n>",
      "parallel best-of-N candidates per review round (default: 1 = serial; N>1 multiplies draft+judge token spend and caps wall time at one round)",
      (v) => parseInt(v, 10),
    )
    .option(
      "--ask",
      "v0.7: emit clarifying questions instead of silent defaults (auto-fires when an agent harness is detected)",
    )
    .option(
      "--no-ask",
      "v0.7: never ask questions — accept defaults even under an agent harness",
    )
    .action(async (topic: string, opts: DraftCliOpts) => {
      process.exitCode = await runDraft({
        topic,
        ...draftCliOptsToDraftOptions(opts),
      });
    });
}
