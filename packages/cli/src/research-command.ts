import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { GLMProvider, loadProviderConfig, MiniMaxProvider } from "@vf/llm";
import { callResearch, MiniMaxWebSearch } from "@vf/research";
import type { ChatMessage, Provider } from "@vf/llm";
import { formatRunId } from "@vf/workflow";
import { stringify as yamlStringify } from "yaml";
import { runNew } from "./new-command.js";
import { ensureProject } from "./ensure-project.js";
import {
  resolveProjectRoot,
  slugifyForProject,
  slugifyProjectName,
} from "./project-path.js";

export interface ResearchOptions {
  topic: string;
  cwd?: string | undefined;
  noWeb?: boolean | undefined;
  model?: "minimax" | "glm" | undefined;
  lang?: "zh-CN" | "en-US" | undefined;
  duration?: number | undefined;
  audience?: string | undefined;
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

export async function runResearch(opts: ResearchOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const slug = slugifyProjectName(opts.topic);
  const projectRoot = path.join(cwd, "projects", slug);
  const lang = opts.lang ?? "zh-CN";
  const duration = opts.duration ?? 40;
  const audience = opts.audience ?? "developers";

  const code = await ensureProject(cwd, slug, projectRoot);
  if (code !== 0) return code;
  if (code !== 0) return code;

  const cfg = loadProviderConfig();
  const roleCfg = cfg["research"];
  const chosenName = opts.model ?? roleCfg.primary;
  const provider = providerInstance(chosenName);
  const model = chosenName === "glm" ? "glm-5.3" : "MiniMax-M3";

  const web = opts.noWeb ? null : new MiniMaxWebSearch();

  let result;
  try {
    result = await callResearch(
      { topic: opts.topic, audience, language: lang, duration },
      provider,
      { web },
    );
  } catch (err) {
    console.error(
      `\u2717 ${chosenName} research agent failed:`,
      (err as Error).message,
    );
    return 1;
  }

  // Ensure research/ exists (runNew already creates it; kept for safety)
  await mkdir(path.join(projectRoot, "research"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "research", "research.md"),
    result.output.markdown,
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "research", "sources.yaml"),
    yamlStringify({ sources: result.output.sources }),
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "research", "claims.yaml"),
    yamlStringify({ claims: result.output.claims }),
    "utf8",
  );

  const runId = formatRunId("research");
  const messages = [
    {
      role: "system" as const,
      content: "Research Agent system prompt (see @vf/research/src/prompt.ts)",
    },
    {
      role: "user" as const,
      content: `Topic: ${opts.topic} | Audience: ${audience} | Language: ${lang} | Duration: ${duration}s`,
    },
  ];
  const record = {
    run_id: runId,
    stage: "research",
    status: "succeeded" as const,
    actor: "agent" as const,
    tool: "vf-research",
    input_commit: safeGitHead(projectRoot),
    input_files: [],
    output_files: [
      "research/research.md",
      "research/sources.yaml",
      "research/claims.yaml",
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

  console.log(`\u2713 drafted ${slug}/research/`);
  console.log(
    `  provider=${chosenName}  sources=${result.output.sources.length}  claims=${result.output.claims.length}  needs_human=${result.output.claims.filter((c) => c.status === "needs_human" || c.status === "uncertain").length}`,
  );
  console.log(
    `  next: edit research.md / claims.yaml, then \`vf storyboard --from-research projects/${slug}/research\``,
  );
  return 0;
}
