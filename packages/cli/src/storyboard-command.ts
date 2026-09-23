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
import { slugifyProjectName } from "./project-path.js";
import { ensureProject } from "./ensure-project.js";

export interface StoryboardOptions {
  topic: string;
  cwd?: string | undefined;
  model?: "minimax" | "glm" | undefined;
  lang?: "zh-CN" | "en-US" | undefined;
  duration?: number | undefined;
  audience?: string | undefined;
  style?: string | undefined;
  fromResearch?: string | undefined;
  fromScript?: string | undefined;
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

export async function runStoryboard(opts: StoryboardOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const slug = slugifyProjectName(opts.topic);
  const projectRoot = path.join(cwd, "projects", slug);
  const lang = opts.lang ?? "zh-CN";
  const duration = opts.duration ?? 40;
  const audience = opts.audience ?? "developers";
  const style = opts.style ?? "dark-tech";

  // Scaffold the project (vf new writes state.yaml + dirs)
  const code = await ensureProject(cwd, slug, projectRoot);
  if (code !== 0) return code;
  if (code !== 0) return code;

  const cfg = loadProviderConfig();
  const roleCfg = cfg["storyboard"];
  const chosenName = opts.model ?? roleCfg.primary;
  const provider = providerInstance(chosenName);
  const model = chosenName === "glm" ? "glm-4.6" : "MiniMax-M2.7";

  // Optional research + script context (v0.2 phases 2 & 3)
  let researchContext: { markdown: string; claimSummary: string } | undefined;
  let scriptContext: { markdown: string } | undefined;
  const { readFile } = await import("node:fs/promises");

  if (opts.fromResearch) {
    let researchMarkdown: string;
    let claimsYaml: string;
    try {
      researchMarkdown = await readFile(
        path.join(opts.fromResearch, "research.md"),
        "utf8",
      );
      claimsYaml = await readFile(
        path.join(opts.fromResearch, "claims.yaml"),
        "utf8",
      );
    } catch {
      console.error(
        `\u2717 --from-research dir missing research.md or claims.yaml: ${opts.fromResearch}`,
      );
      console.error(
        `  run \`vf research <topic>\` first to produce these files`,
      );
      return 1;
    }
    researchContext = {
      markdown: researchMarkdown,
      claimSummary: summarizeClaims(claimsYaml),
    };
  }
  if (opts.fromScript) {
    try {
      const md = await readFile(opts.fromScript, "utf8");
      scriptContext = { markdown: md };
    } catch {
      console.error(`\u2717 --from-script file not found: ${opts.fromScript}`);
      return 1;
    }
  }

  let result;
  try {
    result = await callAgent(
      {
        topic: opts.topic,
        audience,
        duration,
        language: lang,
        style,
        ...(researchContext ? { researchContext } : {}),
        ...(scriptContext ? { scriptContext } : {}),
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
function estimateCost(
  provider: string,
  usage: { input: number; output: number },
): number {
  const rate = provider === "glm" ? 0.0008 : 0.001; // $0.8/M input, $1/M output roughly
  return (usage.input / 1000) * rate + (usage.output / 1000) * rate;
}

/** Compact summary of claims.yaml for the storyboard prompt. */
function summarizeClaims(yamlText: string): string {
  const lines: string[] = [];
  for (const raw of yamlText.split("\n")) {
    const m = raw.match(/^\s*-\s*claim:\s*(.+)$/);
    if (m && m[1]) {
      lines.push(`- ${m[1].trim()}`);
    }
  }
  return lines.join("\n");
}

export type { Storyboard };
