import type { Command } from "commander";
import { GLMProvider, MiniMaxProvider, type Provider } from "@video/llm";
import {
  TranslateArticleError,
  canonicalLanguage,
  captionsSourceFor,
  translateArticle,
} from "@video/draft";
import { resolveProjectDir } from "./project-path.js";
import { MARK_OK, brandBannerLine } from "./ui.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface TranslateOptions {
  project: string;
  lang: string;
  cwd?: string;
  model?: "glm" | "minimax";
  voice?: string;
  force?: boolean;
}

const SUPPORTED_LANGS = new Set(["zh-CN", "en-US"]);

/** Voice default per target language — mirrors draft's pickVoice(). */
function defaultVoice(lang: string): string {
  if (lang === "en-US") return "en-US-ChristopherNeural";
  return "zh-CN-YunjianNeural";
}

function providerInstance(name: string): Provider {
  if (name === "minimax") return new MiniMaxProvider();
  return new GLMProvider();
}

export async function runTranslate(opts: TranslateOptions): Promise<number> {
  if (!SUPPORTED_LANGS.has(opts.lang)) {
    console.error(
      `unsupported language "${opts.lang}" — supported: ${[...SUPPORTED_LANGS].join(", ")}`,
    );
    return 1;
  }
  const resolved = resolveProjectDir(opts.project, opts.cwd);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const projectRoot = resolved.root;
  const canonicalMd = readFileSync(
    path.join(projectRoot, "article.md"),
    "utf8",
  );
  const sourceLang = canonicalLanguage(canonicalMd);
  if (sourceLang === opts.lang) {
    console.error(
      `project is already ${sourceLang} — pick a different target language`,
    );
    return 1;
  }

  console.log(brandBannerLine());
  console.log(
    `▷ ${path.basename(projectRoot)}  ·  translate ${sourceLang} → ${opts.lang}`,
  );
  console.log("");

  try {
    const result = await translateArticle({
      projectRoot,
      targetLang: opts.lang,
      provider: providerInstance(opts.model ?? "glm"),
      voice: opts.voice ?? defaultVoice(opts.lang),
      ...(opts.force !== undefined ? { force: opts.force } : {}),
    });
    console.log(`  ${MARK_OK} translated article → ${result.articlePath}`);
    for (const w of result.warnings) console.log(`  ! ${w}`);
    const captions = captionsSourceFor(opts.lang);
    const rel = path.relative(process.cwd(), result.l10nRoot);
    console.log(
      `\nnext: video approve storyboard --cwd ${rel}` +
        ` && video make ${opts.project} --lang ${opts.lang}` +
        (captions ? "  (captions_source: caption auto-set)" : ""),
    );
    return 0;
  } catch (err) {
    if (err instanceof TranslateArticleError) {
      console.error(`translate failed: ${err.message}`);
      for (const v of err.violations) console.error(`  - ${v}`);
      return 1;
    }
    console.error(`translate failed: ${(err as Error).message}`);
    return 1;
  }
}

export function registerTranslate(program: Command): void {
  program
    .command("translate")
    .description(
      "translate a project's article into a language workdir (l10n/<lang>/) that shares the canonical image set — same pictures, new narration language",
    )
    .argument("<project>", "project: topic, folder name, path, or unique prefix")
    .argument("<lang>", "target language: zh-CN | en-US")
    .option("--cwd <dir>", "base directory for the project")
    .option(
      "--model <provider>",
      "translation model provider: glm (default) | minimax",
    )
    .option(
      "--voice <id>",
      `voice id for the translated audio-config (default: per-language Edge voice)`,
    )
    .option("--force", "overwrite an existing translation")
    .action(async (project: string, lang: string, opts) => {
      process.exitCode = await runTranslate({
        project,
        lang,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.voice !== undefined ? { voice: opts.voice } : {}),
        ...(opts.force === true ? { force: true } : {}),
      });
    });
}

/** Used by make --lang: the l10n workdir doubles as a project root. */
export function l10nRootOrThrow(projectRoot: string, lang: string): string {
  const root = path.join(projectRoot, "l10n", lang);
  if (!existsSync(path.join(root, "article.md"))) {
    throw new Error(
      `no translation at ${root} — run \`video translate <project> ${lang}\` first`,
    );
  }
  return root;
}
