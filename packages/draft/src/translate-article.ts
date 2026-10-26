/**
 * Multi-language support: translate one project's article into a language
 * workdir that shares the canonical image set.
 *
 * Layout (Option A, l10n-workdir shape — decided 2026-10-26):
 *
 *   projects/<id>/
 *     article.md                 ← canonical language (source of truth)
 *     assets/images/             ← SHARED image store (G1 sidecars live here)
 *     l10n/<lang>/
 *       article.md               ← translated; `visual:` lines pinned
 *                                   byte-identical, so the image sidecar
 *                                   cache keys match the canonical ones and
 *                                   `video make` reuses every picture with
 *                                   zero image spend
 *       audio-config.yaml        ← per-language voice
 *       assets/images -> ../../assets/images   (symlink)
 *       state.yaml, storyboard/, assets/audio/, output/, ...
 *
 * The workdir is a full project root, so every existing verb
 * (make / preview / qa / youtube) works on it unchanged; the CLI only adds
 * an `l10n/<lang>` resolution hop (see cli/make-command.ts).
 *
 * Why pin `visual:` lines in code instead of trusting the LLM: the G1
 * sidecar key (`imageCacheKey`) hashes the article's `visual:` string.
 * A reworded line silently re-spends every scene image — the exact cost
 * this feature exists to avoid.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadPrompt, fillPrompt } from "@video/prompts";
import type { Provider } from "@video/llm";
import {
  articleToStoryboardYaml,
  parseArticleLenient,
  type ParsedArticle,
} from "./schemas.js";

// Loaded at import time — the prompt-registry coverage test asserts every
// .md on disk is in the loader cache after imports (orphan guard).
const TRANSLATE_ARTICLE_PROMPT = loadPrompt("translate-article");

export interface TranslateArticleOptions {
  projectRoot: string;
  targetLang: string;
  provider: Provider;
  /** Voice id stamped into the translated audio-config (per language). */
  voice: string;
  /** One re-ask with the violation list when invariants fail (default 2). */
  maxAttempts?: number;
  /** Overwrite an existing translation. */
  force?: boolean;
}

export interface TranslateArticleResult {
  l10nRoot: string;
  articlePath: string;
  warnings: string[];
}

export class TranslateArticleError extends Error {
  readonly violations: string[];
  constructor(message: string, violations: string[] = []) {
    super(message);
    this.name = "TranslateArticleError";
    this.violations = violations;
  }
}

/** Frontmatter `language:` of the canonical article (best effort). */
export function canonicalLanguage(articleMd: string): string {
  const m = /^language:\s*(\S+)\s*$/m.exec(articleMd);
  return m?.[1] ?? "zh-CN";
}

function l10nRootFor(projectRoot: string, lang: string): string {
  return path.join(projectRoot, "l10n", lang);
}

export function l10nArticlePath(
  projectRoot: string,
  lang: string,
): string {
  return path.join(l10nRootFor(projectRoot, lang), "article.md");
}

/** Does a language workdir already exist for this project? */
export function hasL10n(projectRoot: string, lang: string): boolean {
  return existsSync(l10nArticlePath(projectRoot, lang));
}

/** en-* articles burn the short `caption:` label (safe-area rule). */
export function captionsSourceFor(lang: string): "caption" | undefined {
  return lang.toLowerCase().startsWith("en") ? "caption" : undefined;
}

/** Rewrite frontmatter keys on the translated article text. When the voice
 *  is an Edge voice id (xx-XX-*Neural), stamp `tts_provider: edge` — the
 *  canonical article may carry `tts_provider: voicebox`, whose profiles are
 *  language-specific clones that cannot speak the target language. */
function rewriteFrontmatter(
  articleMd: string,
  lang: string,
  voice: string,
): string {
  let out = articleMd;
  const setKey = (key: string, value: string): void => {
    const re = new RegExp(`^${key}:\\s*.*$`, "m");
    if (re.test(out)) out = out.replace(re, `${key}: ${value}`);
    else out = out.replace(/^(language:.*$)/m, `$1\n${key}: ${value}`);
  };
  setKey("language", lang);
  setKey("voice", voice);
  if (/^[a-z]{2,3}-[A-Za-z]{2,4}-\w+Neural$/.test(voice)) {
    setKey("tts_provider", "edge");
  }
  const captions = captionsSourceFor(lang);
  if (captions) setKey("captions_source", captions);
  return out;
}

/** Byte-pin every canonical `visual:` line into the translated text,
 *  matched by scene id so scene order cannot silently drift. */
function pinVisualLines(
  translatedMd: string,
  canonical: ParsedArticle,
): { text: string; violations: string[] } {
  const violations: string[] = [];
  let out = translatedMd;
  for (const scene of canonical.scenes) {
    if (scene.visual.includes("\n")) {
      violations.push(
        `scene ${scene.id}: canonical visual is multi-line — unsupported, translate manually`,
      );
      continue;
    }
    // Anchor on the scene's `id:` line, then replace the next `visual:`
    // line within that scene block (visual is one line by schema usage).
    const re = new RegExp(
      `(- id:\\s*${escapeRegExp(scene.id)}\\n[\\s\\S]*?visual:\\s*)(?:.*)(?=\\n)`,
    );
    if (!re.test(out)) {
      violations.push(`scene ${scene.id}: no visual line found in translation`);
      continue;
    }
    out = out.replace(re, `$1${escapeRegExpReplacement(scene.visual)}`);
  }
  return { text: out, violations };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeRegExpReplacement(s: string): string {
  return s.replace(/\$/g, "$$$$");
}

/** Structural invariants the LLM must not break. */
function validateStructure(
  translatedMd: string,
  canonical: ParsedArticle,
  lang: string,
): string[] {
  const violations: string[] = [];
  let parsed: ParsedArticle;
  try {
    parsed = parseArticleLenient(translatedMd);
  } catch (err) {
    return [`translation does not parse: ${(err as Error).message}`];
  }
  if (parsed.scenes.length !== canonical.scenes.length) {
    violations.push(
      `scene count ${parsed.scenes.length} != canonical ${canonical.scenes.length}`,
    );
    return violations;
  }
  // Frontmatter `language:` is NOT checked here — rewriteFrontmatter()
  // sets it deterministically after validation, so pre-rewrite text
  // legitimately still carries the canonical language.
  parsed.scenes.forEach((scene, i) => {
    const want = canonical.scenes[i];
    if (!want) return;
    if (scene.id !== want.id) {
      violations.push(
        `scene ${i + 1}: id ${scene.id} != canonical ${want.id}`,
      );
    }
    if (scene.visual.trim() !== want.visual.trim()) {
      violations.push(`scene ${scene.id}: visual line changed`);
    }
    if (scene.narration.trim().length === 0) {
      violations.push(`scene ${scene.id}: narration is empty`);
    }
    if (scene.caption.trim().length === 0) {
      violations.push(`scene ${scene.id}: caption is empty`);
    }
  });
  return violations;
}

function buildMessages(articleMd: string, lang: string, extra: string) {
  const template = TRANSLATE_ARTICLE_PROMPT;
  // system = the rules only (everything before the payload section);
  // user = the full filled template (rules + article + task).
  const system = (
    template.split("## Input article")[0] ?? ""
  ).replaceAll("{{TARGET_LANG}}", lang);
  const user = fillPrompt(template, {
    TARGET_LANG: lang,
    ARTICLE: articleMd,
    EXTRA_RULES: extra,
  });
  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

/** Translate the canonical article into a language workdir. */
export async function translateArticle(
  opts: TranslateArticleOptions,
): Promise<TranslateArticleResult> {
  const { projectRoot, targetLang, provider, voice } = opts;
  const canonicalPath = path.join(projectRoot, "article.md");
  if (!existsSync(canonicalPath)) {
    throw new TranslateArticleError(
      `article.md not found at ${canonicalPath}`,
    );
  }
  const canonicalMd = await readFile(canonicalPath, "utf8");
  const canonical = parseArticleLenient(canonicalMd);
  if (canonicalLanguage(canonicalMd) === targetLang) {
    throw new TranslateArticleError(
      `project is already ${targetLang} — pick a different target language`,
    );
  }
  const l10nRoot = l10nRootFor(projectRoot, targetLang);
  if (hasL10n(projectRoot, targetLang) && opts.force !== true) {
    throw new TranslateArticleError(
      `translation exists at ${l10nArticlePath(projectRoot, targetLang)} — pass --force to overwrite`,
    );
  }

  const maxAttempts = opts.maxAttempts ?? 2;
  let translatedMd = "";
  let violations: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const extra =
      attempt === 1
        ? ""
        : `Your previous attempt violated these rules — fix ALL of them:\n${violations.map((v) => `- ${v}`).join("\n")}`;
    const res = await provider.chat({
      messages: buildMessages(canonicalMd, targetLang, extra),
      temperature: 0.3,
    });
    translatedMd = stripFence(res.content.trim());
    const pin = pinVisualLines(translatedMd, canonical);
    translatedMd = pin.text;
    violations = [...pin.violations, ...validateStructure(translatedMd, canonical, targetLang)];
    if (violations.length === 0) break;
  }
  if (violations.length > 0) {
    throw new TranslateArticleError(
      `translation broke structural invariants after ${maxAttempts} attempt(s): ` +
        violations.slice(0, 3).join("; ") +
        (violations.length > 3 ? ` (+${violations.length - 3} more)` : ""),
      violations,
    );
  }

  translatedMd = rewriteFrontmatter(translatedMd, targetLang, voice);

  // Materialize the language workdir.
  await mkdir(path.join(l10nRoot, "storyboard"), { recursive: true });
  await mkdir(path.join(l10nRoot, "assets", "audio"), { recursive: true });
  await mkdir(path.join(l10nRoot, "assets", "fonts"), { recursive: true });
  await mkdir(path.join(l10nRoot, "captions"), { recursive: true });
  await mkdir(path.join(l10nRoot, "checkpoints"), { recursive: true });
  await mkdir(path.join(l10nRoot, "runs"), { recursive: true });
  await mkdir(path.join(l10nRoot, "output"), { recursive: true });
  await writeFile(path.join(l10nRoot, "article.md"), translatedMd, "utf8");

  // Derive the storyboard immediately (same contract as draft): the
  // approve gate needs a file to approve, and `video make` re-derives on
  // every run anyway — article.md stays the source of truth.
  await writeFile(
    path.join(l10nRoot, "storyboard", "storyboard.yaml"),
    articleToStoryboardYaml(parseArticleLenient(translatedMd)),
    "utf8",
  );

  // Per-language audio-config: canonical shape, voice swapped. Regex
  // replace (not YAML round-trip) to preserve comments.
  const audioConfigPath = path.join(projectRoot, "audio-config.yaml");
  const warnings: string[] = [];
  if (existsSync(audioConfigPath)) {
    const cfg = await readFile(audioConfigPath, "utf8");
    const swapped = /^voice:.*$/m.test(cfg)
      ? cfg.replace(/^voice:.*$/m, `voice: ${voice}`)
      : `${cfg.replace(/\s*$/, "\n")}voice: ${voice}\n`;
    await writeFile(
      path.join(l10nRoot, "audio-config.yaml"),
      swapped,
      "utf8",
    );
  } else {
    warnings.push("canonical audio-config.yaml missing — write one before make");
  }

  // Share the canonical image store: relative symlink so the project tree
  // stays movable. The G1 sidecars live INSIDE the shared dir, so image
  // reuse works across languages by construction.
  const imagesLink = path.join(l10nRoot, "assets", "images");
  // Relative target is resolved from the LINK'S PARENT DIR
  // (l10n/<lang>/assets/), so it takes three ups to reach the project root.
  const imagesTarget = path.join("..", "..", "..", "assets", "images");
  if (!existsSync(imagesLink)) {
    if (!existsSync(path.join(projectRoot, "assets", "images"))) {
      warnings.push(
        "canonical assets/images missing — scenes will render as AnimatedIllustration (no generated images to share)",
      );
    }
    await symlink(imagesTarget, imagesLink, "dir");
  }

  const projectId = path.basename(projectRoot);
  // Project-root marker (resolveProjectDir / make need one of state.yaml or
  // storyboard/storyboard.yaml). Mirrors @video/workflow initState's shape
  // without adding a cross-package dependency.
  await writeFile(
    path.join(l10nRoot, "state.yaml"),
    `status: DRAFT
current_stage: init
checkpoint:
  id: ${projectId}-l10n-${targetLang}-init-v1
  status: DRAFT
history_tail: []
`,
    "utf8",
  );

  return {
    l10nRoot,
    articlePath: path.join(l10nRoot, "article.md"),
    warnings,
  };
}

/** Strip a whole-document markdown fence the model may add despite rules.
 *  Anchored to the true string start/end (no /m): the article itself
 *  contains inner ```yaml fences that must not be mistaken for the
 *  document wrapper. */
function stripFence(text: string): string {
  const m = /^```[a-z]*\n([\s\S]*)\n```$/.exec(text);
  return m?.[1] ?? text;
}

/** Read helper kept for symmetry with the rest of the package. */
export function readCanonicalArticle(projectRoot: string): string {
  return readFileSync(path.join(projectRoot, "article.md"), "utf8");
}
