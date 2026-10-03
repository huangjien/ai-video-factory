import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { GLMProvider, loadProviderConfig, MiniMaxProvider } from "@video/llm";
import { callScript } from "@video/script";
import type { ChatMessage, Provider } from "@video/llm";
import { formatRunId } from "@video/workflow";
import { runNew } from "./new-command.js";
import { ensureProject } from "./ensure-project.js";
import { slugifyProjectName } from "./project-path.js";
import { assertStageWritable } from "./stage-guard.js";

export interface ScriptOptions {
  topic: string;
  cwd?: string | undefined;
  model?: "minimax" | "glm" | undefined;
  lang?: "zh-CN" | "en-US" | undefined;
  duration?: number | undefined;
  audience?: string | undefined;
  fromResearch?: string | undefined;
  direction?: string | undefined;
  force?: boolean | undefined;
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unsupported provider: ${name}`);
}

/** Model id stamped for a provider name — matches each provider's own
 * default (GLM: glm-5.3, MiniMax: MiniMax-M3). Re-derived from the
 * SERVING provider after failover so the run record never claims the
 * wrong model. */
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

export async function runScript(opts: ScriptOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const slug = slugifyProjectName(opts.topic);
  const projectRoot = path.join(cwd, "projects", slug);
  const lang = opts.lang ?? "zh-CN";
  const duration = opts.duration ?? 40;
  const audience = opts.audience ?? "developers";

  const code = await ensureProject(cwd, slug, projectRoot);
  if (code !== 0) return code;
  if (!(await assertStageWritable(projectRoot, "script", opts.force === true))) {
    return 1;
  }

  const cfg = loadProviderConfig();
  const roleCfg = cfg["script"];
  const chosenName = opts.model ?? roleCfg.primary;
  const provider = providerInstance(chosenName);
  const fallbackName =
    chosenName === roleCfg.primary
      ? roleCfg.fallback
      : chosenName === roleCfg.fallback
        ? roleCfg.primary
        : undefined;
  const fallback = fallbackName ? providerInstance(fallbackName) : null;

  let researchContext: { markdown: string } | undefined;
  if (opts.fromResearch) {
    const { readFile } = await import("node:fs/promises");
    try {
      const md = await readFile(
        path.join(opts.fromResearch, "research.md"),
        "utf8",
      );
      researchContext = { markdown: md };
    } catch {
      console.error(
        `\u2717 --from-research dir missing research.md: ${opts.fromResearch}`,
      );
      console.error(
        `  run ` +
          "`" +
          `video research "${opts.topic}"` +
          "`" +
          ` first, or omit --from-research to generate the script from the topic alone`,
      );
      return 1;
    }
  }

  let result;
  try {
    result = await callScript(
      {
        topic: opts.topic,
        audience,
        language: lang,
        duration,
        ...(researchContext ? { researchContext } : {}),
        ...(opts.direction ? { direction: opts.direction } : {}),
      },
      provider,
      fallback,
    );
  } catch (err) {
    console.error(
      `\u2717 ${chosenName} script agent failed:`,
      (err as Error).message,
    );
    return 1;
  }

  await mkdir(path.join(projectRoot, "script"), { recursive: true });
  const filename = lang === "en-US" ? "script.en-US.md" : "script.zh-CN.md";
  const md = renderScriptMarkdown(result.script);
  await writeFile(path.join(projectRoot, "script", filename), md, "utf8");

  const runId = formatRunId("script");
  // model reflects the SERVING provider (may differ from the chosen one
  // after failover) and prompt_hash hashes the messages the agent actually
  // sent (result.messages), not a reconstructed placeholder.
  const servedModel = modelFor(result.providerName);
  const record = {
    run_id: runId,
    stage: "script",
    status: "succeeded" as const,
    actor: "agent" as const,
    tool: "video-script",
    input_commit: safeGitHead(projectRoot),
    input_files: [],
    output_files: [`script/${filename}`],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: result.providerName,
    model: servedModel,
    prompt_hash: sha256OfMessages(result.messages),
    tokens: result.usage,
    estimated_cost_usd:
      (result.usage.input / 1000) *
        (result.providerName === "glm" ? 0.0008 : 0.001) +
      (result.usage.output / 1000) *
        (result.providerName === "glm" ? 0.0008 : 0.001),
  };
  const { writeRun } = await import("@video/workflow");
  await writeRun(projectRoot, record);

  console.log(`\u2713 drafted ${slug}/script/${filename}`);
  console.log(
    `  provider=${result.providerName}  sections=7  tokens=${result.usage.input}+${result.usage.output}`,
  );
  console.log(
    `  next: edit, then \`video storyboard "${opts.topic}"\` (storyboard picks up the script's structure)`,
  );
  return 0;
}

function renderScriptMarkdown(s: {
  hook: string;
  problem: string;
  explanation: string;
  example: string;
  comparison: string;
  implication: string;
  conclusion: string;
}): string {
  return `# Script

## Hook
${s.hook}

## Problem
${s.problem}

## Explanation
${s.explanation}

## Example
${s.example}

## Comparison
${s.comparison}

## Implication
${s.implication}

## Conclusion
${s.conclusion}
`;
}
