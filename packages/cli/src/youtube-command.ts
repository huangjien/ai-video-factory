import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { GLMProvider, loadProviderConfig, MiniMaxProvider } from "@vf/llm";
import { callYouTube, chaptersToVtt } from "@vf/youtube";
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
  const projectRoot = path.join(cwd, "projects", opts.project);
  if (!existsSync(projectRoot)) {
    console.error(`project not found: ${projectRoot}`);
    return 1;
  }
  const { readFile } = await import("node:fs/promises");
  const sbPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
  const scriptPath = path.join(projectRoot, "script", "script.zh-CN.md");
  const researchMdPath = path.join(projectRoot, "research", "research.md");
  for (const f of [sbPath, scriptPath, researchMdPath]) {
    if (!existsSync(f)) {
      console.error(`missing input: ${f}`);
      console.error(`  run vf storyboard / vf script / vf research first`);
      return 1;
    }
  }
  const storyboard = await readFile(sbPath, "utf8");
  const script = await readFile(scriptPath, "utf8");
  const research = await readFile(researchMdPath, "utf8");

  const cfg = loadProviderConfig();
  const chosenName = opts.model ?? cfg["review"].primary; // review-role default → conservative
  const provider = providerInstance(chosenName);
  const model = chosenName === "glm" ? "glm-4.6" : "MiniMax-M2.7";

  let result;
  try {
    result = await callYouTube({ storyboard, script, research }, provider);
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
    input_files: [
      "storyboard/storyboard.yaml",
      "script/script.zh-CN.md",
      "research/research.md",
    ],
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
    provider: chosenName,
    model,
    prompt_hash: sha256OfMessages(messages),
    tokens: result.usage,
    estimated_cost_usd:
      (result.usage.input / 1000) * (chosenName === "glm" ? 0.0008 : 0.001) +
      (result.usage.output / 1000) * (chosenName === "glm" ? 0.0008 : 0.001),
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
