import type { Command } from "commander";
import { mkdir } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { execSync } from "node:child_process";
import type { ChatMessage, Provider } from "@video/llm";
import { GLMProvider, loadProviderConfig, MiniMaxProvider } from "@video/llm";
import { callAgent } from "@video/agent-storyboard";
import { DEFAULT_THEME_NAME } from "@video/theme";
import { formatRunId } from "@video/workflow";
import type { Storyboard } from "@video/vdsl/schema.js";
import { stringify as yamlStringify } from "yaml";
import { runNew } from "./new-command.js";
import { slugifyProjectName } from "./project-path.js";
import { ensureProject } from "./ensure-project.js";
import { assertStageWritable } from "./stage-guard.js";

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
  force?: boolean | undefined;
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unsupported provider: ${name}`);
}

/** Model id stamped for a provider name — matches each provider's own
 * default (GLM: glm-5.3, MiniMax: MiniMax-M3). Used for the primary
 * request and, after failover, re-derived from the SERVING provider
 * so the run record never claims the wrong model. */
function modelFor(name: string): string {
  return name === "glm" ? "glm-5.3" : "MiniMax-M3";
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
  const duration = opts.duration ?? 180;
  const audience = opts.audience ?? "developers";
  const style = opts.style ?? DEFAULT_THEME_NAME;

  // Scaffold the project (video new writes state.yaml + dirs)
  const code = await ensureProject(cwd, slug, projectRoot);
  if (code !== 0) return code;

  // Refuse to overwrite a human-approved storyboard (or a FINAL_APPROVED
  // project) unless explicitly forced — before spending any LLM tokens.
  if (
    !(await assertStageWritable(projectRoot, "storyboard", opts.force === true))
  ) {
    return 1;
  }

  const cfg = loadProviderConfig();
  const roleCfg = cfg["storyboard"];
  const chosenName = opts.model ?? roleCfg.primary;
  const provider = providerInstance(chosenName);
  const fallbackName =
    chosenName === roleCfg.primary
      ? roleCfg.fallback
      : chosenName === roleCfg.fallback
        ? roleCfg.primary
        : undefined;
  const fallback = fallbackName ? providerInstance(fallbackName) : null;
  const model = modelFor(chosenName);

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
        `  run \`video research <topic>\` first to produce these files`,
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
      fallback,
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

  // Run record with extended schema (provider/model/prompt_hash/tokens/cost).
  // model reflects the SERVING provider (may differ from the chosen one
  // after failover) and prompt_hash hashes the messages the agent actually
  // sent (result.messages), not a reconstructed placeholder.
  const runId = formatRunId("storyboard");
  const servedModel = modelFor(result.providerName);
  const costUsd = estimateCost(result.providerName, result.usage);
  const record = {
    run_id: runId,
    stage: "storyboard" as const,
    status: "succeeded" as const,
    actor: "agent" as const,
    tool: "video-storyboard",
    input_commit: safeGitHead(projectRoot),
    input_files: [],
    output_files: ["storyboard/storyboard.yaml"],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: result.providerName,
    model: servedModel,
    prompt_hash: sha256OfMessages(result.messages),
    tokens: result.usage,
    estimated_cost_usd: costUsd,
  };

  const { writeRun } = await import("@video/workflow");
  await writeRun(projectRoot, record);

  console.log(`\u2713 drafted ${slug}/storyboard/storyboard.yaml`);
  console.log(
    `  provider=${result.providerName}  model=${servedModel}  scenes=${result.storyboard.scenes.length}  tokens=${result.usage.input}+${result.usage.output}  cost=$${costUsd.toFixed(4)}`,
  );
  console.log(
    `  next: edit storyboard, then \`video approve storyboard\` then \`video preview --cwd ${path.relative(cwd, projectRoot) || "."}\``,
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

export function registerStoryboard(program: Command): void {
  program
    .command("storyboard")
    .argument("<topic>", "topic to draft a storyboard for")
    .option("--cwd <dir>", "base directory for the project")
    .option(
      "--model <provider>",
      "model provider: minimax|glm (default from config)",
    )
    .option("--lang <lang>", "language: zh-CN|en-US (default zh-CN)")
    .option("--duration <seconds>", "total duration target", (v) =>
      parseInt(v, 10),
    )
    .option("--audience <text>", "target audience (default: developers)")
    .option("--style <text>", `visual style (default: ${DEFAULT_THEME_NAME})`)
    .option(
      "--from-research <dir>",
      "consume approved research from this directory",
    )
    .option(
      "--from-script <file>",
      "consume approved script from this file (e.g. script/script.zh-CN.md)",
    )
    .option(
      "--force",
      "redraft even when the storyboard checkpoint is approved or the project is FINAL_APPROVED (prints a warning)",
    )
    .action(
      async (
        topic: string,
        opts: {
          cwd?: string;
          model?: "minimax" | "glm";
          lang?: "zh-CN" | "en-US";
          duration?: number;
          audience?: string;
          style?: string;
          fromResearch?: string;
          fromScript?: string;
          force?: boolean;
        },
      ) => {
        process.exitCode = await runStoryboard({
          topic,
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.model !== undefined ? { model: opts.model } : {}),
          ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
          ...(opts.duration !== undefined ? { duration: opts.duration } : {}),
          ...(opts.audience !== undefined ? { audience: opts.audience } : {}),
          ...(opts.style !== undefined ? { style: opts.style } : {}),
          ...(opts.fromResearch !== undefined
            ? { fromResearch: opts.fromResearch }
            : {}),
          ...(opts.fromScript !== undefined
            ? { fromScript: opts.fromScript }
            : {}),
          ...(opts.force !== undefined ? { force: opts.force } : {}),
        });
      },
    );
}
