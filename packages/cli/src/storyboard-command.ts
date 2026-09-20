import { mkdir } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { execSync } from "node:child_process";
import type { ChatMessage, Provider } from "@vf/llm";
import { GLMProvider, loadProviderConfig, MiniMaxProvider } from "@vf/llm";
import { callAgent } from "@vf/agent-storyboard";
import { formatRunId } from "@vf/workflow";
import type { Storyboard } from "@vf/vdsl/schema.js";
import { stringify as yamlStringify } from "yaml";
import { runNew } from "./new-command.js";

export interface StoryboardOptions {
  topic: string;
  cwd?: string | undefined;
  model?: "minimax" | "glm" | undefined;
  lang?: "zh-CN" | "en-US" | undefined;
  duration?: number | undefined;
  audience?: string | undefined;
  style?: string | undefined;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "project";
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  return new MiniMaxProvider();
}

function sha256OfMessages(messages: ChatMessage[]): string {
  const canon = JSON.stringify(messages.map((m) => ({ role: m.role, content: m.content })));
  return "sha256:" + createHash("sha256").update(canon).digest("hex");
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export async function runStoryboard(opts: StoryboardOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const slug = slugify(opts.topic);
  const projectRoot = path.join(cwd, "projects", slug);
  const lang = opts.lang ?? "zh-CN";
  const duration = opts.duration ?? 40;
  const audience = opts.audience ?? "developers";
  const style = opts.style ?? "dark-tech";

  // Scaffold the project (vf new writes state.yaml + dirs)
  const code = await runNew({ projectId: slug, cwd });
  if (code !== 0) return code;

  const cfg = loadProviderConfig();
  const roleCfg = cfg["storyboard"];
  const chosenName = opts.model ?? roleCfg.primary;
  const provider = providerInstance(chosenName);
  const model = chosenName === "glm" ? "glm-4.6" : "MiniMax-M2.7";

  let result;
  try {
    result = await callAgent(
      {
        topic: opts.topic,
        audience,
        duration,
        language: lang,
        style,
      },
      provider,
      { model, temperature: 0.7 },
    );
  } catch (err) {
    console.error(`\u2717 ${chosenName} agent failed:`, (err as Error).message);
    return 1;
  }

  // Build the storyboard.yaml with normalized defaults (compileStoryboard does this,
  // but we want the raw agent output here; rely on validateStoryboard already passing)
  const yaml = yamlStringify(result.storyboard);
  await mkdir(path.join(projectRoot, "storyboard"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "storyboard", "storyboard.yaml"),
    yaml,
    "utf8",
  );

  // Run record with extended schema (provider/model/prompt_hash/tokens/cost)
  const runId = formatRunId("storyboard");
  const messages = [
    {
      role: "system" as const,
      content:
        "Storyboard Agent system prompt (see @vf/agent-storyboard/src/prompt.ts)",
    },
    {
      role: "user" as const,
      content: `Topic: ${opts.topic} | Audience: ${audience} | Language: ${lang} | Duration: ${duration}s | Style: ${style}`,
    },
  ];
  const costUsd = estimateCost(chosenName, result.usage);
  const record = {
    run_id: runId,
    stage: "storyboard" as const,
    status: "succeeded" as const,
    actor: "agent" as const,
    tool: "vf-storyboard",
    input_commit: safeGitHead(projectRoot),
    input_files: [],
    output_files: ["storyboard/storyboard.yaml"],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: chosenName,
    model,
    prompt_hash: sha256OfMessages(messages),
    tokens: result.usage,
    estimated_cost_usd: costUsd,
  };

  const { writeRun } = await import("@vf/workflow");
  await writeRun(projectRoot, record);

  console.log(`\u2713 drafted ${slug}/storyboard/storyboard.yaml`);
  console.log(
    `  provider=${chosenName}  model=${model}  scenes=${result.storyboard.scenes.length}  tokens=${result.usage.input}+${result.usage.output}  cost=$${costUsd.toFixed(4)}`,
  );
  console.log(
    `  next: edit storyboard, then \`vf approve storyboard\` then \`vf preview --cwd ${path.relative(cwd, projectRoot) || "."}\``,
  );
  return 0;
}

/** Rough cost estimates per 1K tokens (MiniMax / GLM Coding Plan pricing
 * is bundled; we use a conservative blended rate for token tracking only,
 * NOT billing — see doc §45 cost strategy. */
function estimateCost(provider: string, usage: { input: number; output: number }): number {
  const rate = provider === "glm" ? 0.0008 : 0.001; // $0.8/M input, $1/M output roughly
  return (usage.input / 1000) * rate + (usage.output / 1000) * rate;
}

export type { Storyboard };
