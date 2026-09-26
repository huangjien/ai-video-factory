import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { resolveProjectDir } from "./project-path.js";
import { existsSync } from "node:fs";
import { GLMProvider, loadProviderConfig, MiniMaxProvider } from "@vf/llm";
import { callYouTube, chaptersToVtt, type YouTubeInput } from "@vf/youtube";
import { parseArticleWithRecovery, type Scene } from "@vf/draft";
import { stringify as yamlStringify } from "yaml";
import type { ChatMessage, Provider } from "@vf/llm";
import { formatRunId } from "@vf/workflow";

export interface YouTubeOptions {
  project: string;
  cwd?: string | undefined;
  model?: "minimax" | "glm" | undefined;
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  return new MiniMaxProvider();
}

function sha256OfMessages(messages: ChatMessage[]): string {
  const canon = JSON.stringify(
    messages.map((m) => ({ role: m.role, content: m.content })),
  );
  return "sha256:" + createHash("sha256").update(canon).digest("hex");
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export async function runYouTube(opts: YouTubeOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const resolvedProject = resolveProjectDir(opts.project, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    return 1;
  }
  const projectRoot = resolvedProject.root;
  const { readFile } = await import("node:fs/promises");

// Two input shapes supported: article.md (preferred) OR the legacy triple
  // (research.md + script.md + storyboard.yaml). The agent takes the
  // legacy triple; article.md is synthesized to that shape below.
  let articleInput: ReturnType<typeof synthFromArticle> | null = null;
  let legacyInput: YouTubeInput | null = null;
  const articlePath = path.join(projectRoot, "article.md");
  if (existsSync(articlePath)) {
    articleInput = await synthFromArticle(
      await readFile(articlePath, "utf8"),
    );
  } else {
    const sbPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
    const scriptPath = path.join(projectRoot, "script", "script.zh-CN.md");
    const researchMdPath = path.join(projectRoot, "research", "research.md");
    for (const f of [sbPath, scriptPath, researchMdPath]) {
      if (!existsSync(f)) {
        console.error(`missing input: ${f}`);
        console.error(
          `  run \`vf draft <topic>\` to generate article.md (preferred),`,
        );
        console.error(
          `  or run the legacy pipeline: vf research / vf script / vf storyboard`,
        );
        return 1;
      }
    }
    legacyInput = {
      storyboard: await readFile(sbPath, "utf8"),
      script: await readFile(scriptPath, "utf8"),
      research: await readFile(researchMdPath, "utf8"),
    };
  }
  const input: YouTubeInput = articleInput ?? (legacyInput as YouTubeInput);
  const inputFiles = articleInput
    ? ["article.md"]
    : [
        "storyboard/storyboard.yaml",
        "script/script.zh-CN.md",
        "research/research.md",
      ];

  const cfg = loadProviderConfig();
  const reviewCfg = cfg["review"];
  const chosenName = opts.model ?? reviewCfg.primary;
  const provider = providerInstance(chosenName);
  const fallbackName =
    chosenName === reviewCfg.primary
      ? reviewCfg.fallback
      : chosenName === reviewCfg.fallback
        ? reviewCfg.primary
        : undefined;
  const fallback = fallbackName ? providerInstance(fallbackName) : null;
  const model = chosenName === "glm" ? "glm-5.3" : "MiniMax-M3";

  let result;
  try {
    result = await callYouTube(input, provider, fallback);
  } catch (err) {
    console.error(
      `\u2717 ${chosenName} youtube agent failed:`,
      (err as Error).message,
    );
    return 1;
  }

  await mkdir(path.join(projectRoot, "youtube"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "youtube", "title.txt"),
    result.youtube.title + "\n",
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "youtube", "description.md"),
    result.youtube.description + "\n",
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "youtube", "package.yaml"),
    yamlStringify(result.youtube),
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "youtube", "chapters.vtt"),
    chaptersToVtt(result.youtube.chapters),
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "youtube", "thumbnail-prompt.txt"),
    result.youtube.thumbnail_prompt + "\n",
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "youtube", "shorts-hook.txt"),
    result.youtube.shorts_hook + "\n",
    "utf8",
  );

  // Run record
  const runId = formatRunId("youtube");
  const messages = [
    {
      role: "system" as const,
      content:
        "YouTube Automation Agent system prompt (see @vf/youtube/src/agent.ts)",
    },
    {
      role: "user" as const,
      content: `Packaging project: ${opts.project}`,
    },
  ];
  const record = {
    run_id: runId,
    stage: "youtube",
    status: "succeeded" as const,
    actor: "agent" as const,
    tool: "vf-youtube",
    input_commit: safeGitHead(projectRoot),
    input_files: inputFiles,
    output_files: [
      "youtube/title.txt",
      "youtube/description.md",
      "youtube/package.yaml",
      "youtube/chapters.vtt",
      "youtube/thumbnail-prompt.txt",
      "youtube/shorts-hook.txt",
    ],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: result.providerName,
    model,
    prompt_hash: sha256OfMessages(messages),
    tokens: result.usage,
    estimated_cost_usd:
      (result.usage.input / 1000) *
        (result.providerName === "glm" ? 0.0008 : 0.001) +
      (result.usage.output / 1000) *
        (result.providerName === "glm" ? 0.0008 : 0.001),
  };
  const { writeRun } = await import("@vf/workflow");
  await writeRun(projectRoot, record);

  console.log(`\u2713 packaged ${opts.project}/youtube/`);
  console.log(`  title: ${result.youtube.title}`);
  console.log(
    `  chapters: ${result.youtube.chapters.length} · vtt=youtube/chapters.vtt`,
  );
  console.log(
    `  next: copy title + description into YouTube Studio; thumbnail + Shorts land in v0.2 phase 8`,
  );
  return 0;
}

/** Build a legacy-shaped YouTubeInput from the new article.md —
 * the YouTube agent consumes three string fields; this maps each. */
function synthFromArticle(articleMd: string): YouTubeInput {
  const { article } = parseArticleWithRecovery(articleMd);
  const storyboard = synthStoryboardYaml(article.scenes);
  const script = `# ${article.frontmatter.project}\n\n${article.proseBody.trim()}\n`;
  const research = articleMd;
  return { storyboard, script, research };
}

function synthStoryboardYaml(scenes: Scene[]): string {
  const lines = [
    `scenes:`,
    ...scenes.flatMap((s) => [
      `  - id: ${s.id}`,
      `    duration: ${s.duration}`,
      `    caption: ${yamlScalar(s.caption)}`,
      `    visual: ${yamlScalar(s.visual)}`,
    ]),
  ];
  return lines.join("\n") + "\n";
}

function yamlScalar(s: string): string {
  if (/[:#\n]/.test(s)) return JSON.stringify(s);
  return s;
}
