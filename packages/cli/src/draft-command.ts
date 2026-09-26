import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  GLMProvider,
  MiniMaxProvider,
  loadProviderConfig,
  providerForRole,
  type Provider,
} from "@vf/llm";
import { MiniMaxWebSearch } from "@vf/research";
import {
  articleToStoryboardYaml,
  callDraft,
  parseArticleWithRecovery,
} from "@vf/draft";
import { slugifyProjectName } from "./project-path.js";

export interface DraftOptions {
  topic: string;
  cwd?: string;
  model?: "minimax" | "glm";
  lang?: "zh-CN" | "en-US";
  duration?: number;
  audience?: string;
  /** Path to a file containing pre-existing content to revise. */
  from?: string;
  noWeb?: boolean;
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unsupported provider: ${name}`);
}

export async function runDraft(opts: DraftOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const projectId = slugifyProjectName(opts.topic);
  const projectRoot = path.join(cwd, "projects", projectId);

  if (!existsSync(projectRoot)) {
    console.error(`project not found: ${projectRoot}`);
    console.error(`hint: scaffold it with \`vf new <id>\` first, then re-run`);
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

  const { markdown, usage } = await callDraft(
    {
      topic: opts.topic,
      audience,
      language,
      duration,
      ...(fromContent !== undefined ? { fromContent } : {}),
      ...(webContext && webContext.length > 0 ? { webContext } : {}),
    },
    provider,
    fallback,
  );

  const articlePath = path.join(projectRoot, "article.md");
  await mkdir(path.dirname(articlePath), { recursive: true });
  await writeFile(articlePath, markdown, "utf8");

  // Sync storyboard.yaml with article.md so vf make doesn't render
  // 1 scene while TTS synthesizes N.
  const storyboardPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
  try {
    const { article, recoveredCount } = parseArticleWithRecovery(markdown);
    await writeFile(storyboardPath, articleToStoryboardYaml(article), "utf8");
    if (recoveredCount > 0) {
      console.error(
        `  ! draft shipped ${recoveredCount} empty scene narrations — recovered from section bodies.`,
      );
      console.error(
        `  (edit the narrations in article.md, or re-run with --from to revise)`,
      );
    }
  } catch (err) {
    console.error(
      `  ! could not refresh storyboard.yaml from article.md: ${(err as Error).message}`,
    );
    console.error(
      "  (article.md was written; render will still use the existing storyboard.yaml)",
    );
  }

  console.log(`✓ drafted ${articlePath}`);
  console.log(
    `  model=${opts.model ?? "glm"}  tokens=${usage.input}+${usage.output}`,
  );
  console.log(
    `  next: edit article.md to refine the narrative, then \`vf audio-plan <topic>\``,
  );
  return 0;
}
