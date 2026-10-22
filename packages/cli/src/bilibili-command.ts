import type { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveProjectDir } from "./project-path.js";
import { GLMProvider, loadProviderConfig, MiniMaxProvider } from "@video/llm";
import { callBilibili, renderChecklist } from "@video/bilibili";
import { parseArticleWithRecovery } from "@video/draft";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import type { ChatMessage, Provider } from "@video/llm";
import { formatRunId } from "@video/workflow";
import { MARK_OK, MARK_RUN, brandBannerLine, channelHeader } from "./ui.js";

export interface BilibiliOptions {
  project: string;
  cwd?: string | undefined;
  model?: "minimax" | "glm" | undefined;
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unknown provider: ${name}`);
}

function sha256OfMessages(messages: ChatMessage[] | undefined): string {
  const text = (messages ?? [])
    .map((m) => `${m.role}:${m.content}`)
    .join("\n\n");
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Cumulative runtime from the durations the renderer actually used — the
 * same source YouTube chapter offsets come from. */
function totalRuntime(
  storyboardYaml: string | undefined,
  fallbackSec: number | undefined,
): number | undefined {
  if (storyboardYaml !== undefined) {
    try {
      const parsed = parseYaml(storyboardYaml) as {
        scenes?: { duration?: unknown }[];
      };
      const durations = (parsed.scenes ?? [])
        .map((s) => (typeof s.duration === "number" ? s.duration : 0))
        .filter((d) => d > 0);
      const total = durations.reduce((a, b) => a + b, 0);
      if (total > 0) return total;
    } catch {
      // fall through to the declared target
    }
  }
  return fallbackSec;
}

/** The article's own H1 is a far better topic than the folder slug — the slug
 * is whatever `video new` derived from the user's prompt. */
function articleTitle(proseBody: string, fallback: string): string {
  const h1 = proseBody.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return h1 && h1.length > 0 ? h1 : fallback;
}

function extractHook(proseBody: string): string {
  const m = proseBody.match(/^>\s*\*\*Hook\*\*[^\n]*\n+>\s*(.+)$/m);
  return m?.[1]?.trim() ?? "";
}

export async function runBilibili(opts: BilibiliOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const resolved = resolveProjectDir(opts.project, opts.cwd);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const projectRoot = resolved.root;

  const articlePath = path.join(projectRoot, "article.md");
  if (!existsSync(articlePath)) {
    console.error(`missing article.md in ${projectRoot}`);
    console.error(`  run \`video draft <topic>\` first`);
    return 1;
  }
  const articleMd = await readFile(articlePath, "utf8");
  const { article } = parseArticleWithRecovery(articleMd);

  const renderedPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
  const rendered = existsSync(renderedPath)
    ? await readFile(renderedPath, "utf8")
    : undefined;

  // Reuse the YouTube cover brief when one exists: same audience, same video,
  // and it keeps the two platforms looking like one channel.
  const youtubePkgPath = path.join(projectRoot, "youtube", "package.yaml");
  let youtubeCoverPrompt: string | undefined;
  if (existsSync(youtubePkgPath)) {
    try {
      const parsed = parseYaml(await readFile(youtubePkgPath, "utf8")) as {
        thumbnail_prompt?: unknown;
      };
      if (typeof parsed.thumbnail_prompt === "string") {
        youtubeCoverPrompt = parsed.thumbnail_prompt;
      }
    } catch {
      // a broken youtube package must not block bilibili packaging
    }
  }

  const cfg = loadProviderConfig();
  const reviewCfg = cfg["review"];
  const chosenName = opts.model ?? reviewCfg.primary;
  const fallbackName =
    chosenName === reviewCfg.primary
      ? reviewCfg.fallback
      : chosenName === reviewCfg.fallback
        ? reviewCfg.primary
        : undefined;

  console.log(brandBannerLine());
  console.log(channelHeader(opts.project, "bilibili · packaging only"));
  console.log("");
  console.log(
    `${MARK_RUN} bilibili package (no upload — Bilibili has no public API)`,
  );

  const result = await callBilibili(
    {
      article: articleMd,
      topic: articleTitle(article.proseBody, article.frontmatter.project),
      hook: extractHook(article.proseBody),
      ...(article.frontmatter.image_style
        ? { imageStyle: article.frontmatter.image_style }
        : {}),
      ...(totalRuntime(rendered, article.frontmatter.duration_target_sec) !==
      undefined
        ? {
            durationSec: totalRuntime(
              rendered,
              article.frontmatter.duration_target_sec,
            ),
          }
        : {}),
    },
    providerInstance(chosenName),
    fallbackName ? providerInstance(fallbackName) : null,
    youtubeCoverPrompt !== undefined ? { youtubeCoverPrompt } : undefined,
  );

  const bilibiliDir = path.join(projectRoot, "bilibili");
  await mkdir(bilibiliDir, { recursive: true });

  const videoPath = path.join(projectRoot, "output", "final-mixed.mp4");
  const coverPath = path.join(bilibiliDir, "cover.jpg");

  await writeFile(
    path.join(bilibiliDir, "package.yaml"),
    yamlStringify(result.bilibili),
    "utf8",
  );
  await writeFile(
    path.join(bilibiliDir, "cover-prompt.txt"),
    result.bilibili.cover_prompt + "\n",
    "utf8",
  );
  const checklist = renderChecklist({
    pkg: result.bilibili,
    videoPath,
    ...(existsSync(coverPath) ? { coverPath } : {}),
    ...(result.warning !== undefined ? { warning: result.warning } : {}),
  });
  await writeFile(path.join(bilibiliDir, "CHECKLIST.md"), checklist, "utf8");

  const runId = formatRunId("bilibili");
  const { writeRun } = await import("@video/workflow");
  await writeRun(projectRoot, {
    run_id: runId,
    stage: "bilibili",
    status: "succeeded" as const,
    actor: "agent" as const,
    tool: "video-bilibili",
    input_commit: safeGitHead(projectRoot),
    input_files: ["article.md"],
    output_files: [
      "bilibili/package.yaml",
      "bilibili/cover-prompt.txt",
      "bilibili/CHECKLIST.md",
    ],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: result.providerName ?? chosenName,
    model: result.providerName ?? chosenName,
    prompt_hash: sha256OfMessages(result.messages),
    tokens: undefined,
    estimated_cost_usd: undefined,
  });

  console.log("");
  console.log(
    `${MARK_OK} packaged ${path.relative(process.cwd(), bilibiliDir)}/`,
  );
  console.log(`  title: ${result.bilibili.title}`);
  console.log(
    `  tags : ${result.bilibili.tags.length > 0 ? result.bilibili.tags.join("、") : "(none — pick manually)"}`,
  );
  console.log(
    `  分区 : ${result.bilibili.suggested_category ?? "(no confident pick — choose in the form)"}`,
  );
  if (result.source === "fallback") {
    console.log("");
    console.log(
      `  ⚠ degraded to the deterministic fallback: ${result.warning}`,
    );
    console.log(
      `    metadata was derived from article.md without an LLM — plain, but valid.`,
    );
  }
  console.log("");
  console.log(`  → open bilibili/CHECKLIST.md for the manual upload steps`);
  console.log(
    `  → Bilibili exposes no public upload API, so the final step is by hand.`,
  );
  return 0;
}

export function registerBilibili(program: Command): void {
  program
    .command("bilibili")
    .argument("[project]", "project to package: topic, folder name, or path")
    .description(
      "Bilibili submission metadata (packaging only — Bilibili has no public upload API)",
    )
    .option("--cwd <dir>", "base directory for the project")
    .option(
      "--model <provider>",
      "model provider: minimax|glm (default from config)",
    )
    .action(async (project: string | undefined, opts) => {
      if (project === undefined) {
        console.error("bilibili requires a project argument");
        process.exitCode = 1;
        return;
      }
      process.exitCode = await runBilibili({
        project,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.model !== undefined ? { model: opts.model } : {}),
      });
    });
}
