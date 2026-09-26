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
import { parseArticle, parseArticleWithRecovery } from "@vf/draft";
import { callAudioPlan } from "@vf/audio-plan";
import { resolveProjectDir } from "./project-path.js";

export interface AudioPlanOptions {
  project: string;
  cwd?: string;
  model?: "minimax" | "glm";
  from?: string;
  strict?: boolean;
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unsupported provider: ${name}`);
}

export async function runAudioPlan(opts: AudioPlanOptions): Promise<number> {
  const resolvedProject = resolveProjectDir(opts.project, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    return 1;
  }
  const projectRoot = resolvedProject.root;
  const articlePath = path.join(projectRoot, "article.md");

  if (!existsSync(projectRoot)) {
    console.error(`project not found: ${projectRoot}`);
    return 1;
  }
  if (!existsSync(articlePath)) {
    console.error(`article.md not found at ${articlePath}`);
    console.error(`hint: run \`vf draft <topic>\` first`);
    return 1;
  }

  const articleMd = await readFile(articlePath, "utf8");
  let article;
  if (opts.strict) {
    try {
      article = parseArticle(articleMd);
    } catch (err) {
      console.error(`failed to parse article.md: ${(err as Error).message}`);
      return 1;
    }
  } else {
    try {
      const parsed = parseArticleWithRecovery(articleMd);
      article = parsed.article;
      if (parsed.recoveredCount > 0) {
        console.error(`! article.md had ${parsed.recoveredCount} empty scene narrations`);
        console.error(`  (the LLM put all content in ## section bodies — recovered from them)`);
        console.error(`  next: re-run \`vf draft --from ${articlePath}\` to regenerate cleanly,`);
        console.error(`        or hand-edit each scene's narration in article.md.`);
      }
    } catch (err) {
      console.error(`failed to parse article.md: ${(err as Error).message}`);
      return 1;
    }
  }

  let fromContent: string | undefined;
  if (opts.from) {
    fromContent = await readFile(path.resolve(opts.from), "utf8");
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

  const { config, yaml, usage } = await callAudioPlan(
    {
      article,
      language: article.frontmatter.language,
      ...(fromContent !== undefined ? { fromContent } : {}),
    },
    provider,
    fallback,
  );

  const outPath = path.join(projectRoot, "audio-config.yaml");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, yaml, "utf8");

  console.log(`✓ drafted ${outPath}`);
  const sfxCount = Object.keys(config.sfx ?? {}).length;
  console.log(
    `  voice=${config.voice ?? "(default)"}  bgm=${config.bgm ?? "(none)"}  sfx=${sfxCount}`,
  );
  console.log(
    `  model=${opts.model ?? "glm"}  tokens=${usage.input}+${usage.output}`,
  );
  console.log(
    `  next: edit audio-config.yaml (set bgm, sfx, fades), then \`vf make ${opts.project}\``,
  );
  return 0;
}
