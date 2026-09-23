import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { GLMProvider, loadProviderConfig, MiniMaxProvider } from "@vf/llm";
import { callReview, ReviewPackageSchema } from "@vf/review";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import type { ChatMessage, Provider } from "@vf/llm";
import { formatRunId } from "@vf/workflow";

export interface ReviewOptions {
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

export async function runReview(opts: ReviewOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const projectRoot = path.join(cwd, "projects", opts.project);
  if (!existsSync(projectRoot)) {
    console.error(`project not found: ${projectRoot}`);
    return 1;
  }
  const { readFile } = await import("node:fs/promises");
  const sbPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
  const scriptPath = path.join(projectRoot, "script", "script.zh-CN.md");
  const claimsPath = path.join(projectRoot, "research", "claims.yaml");
  for (const f of [sbPath, scriptPath, claimsPath]) {
    if (!existsSync(f)) {
      console.error(`missing input: ${f}`);
      console.error(`  run vf storyboard / vf script / vf research first`);
      return 1;
    }
  }
  const storyboard = await readFile(sbPath, "utf8");
  const script = await readFile(scriptPath, "utf8");
  const claims = await readFile(claimsPath, "utf8");

  const cfg = loadProviderConfig();
  const chosenName = opts.model ?? cfg["research"].primary; // research role provider is the most "careful" default
  const provider = providerInstance(chosenName);
  const model = chosenName === "glm" ? "glm-5.3" : "MiniMax-M3";

  let result;
  try {
    result = await callReview({ storyboard, script, claims }, provider);
  } catch (err) {
    console.error(
      `\u2717 ${chosenName} review agent failed:`,
      (err as Error).message,
    );
    return 1;
  }

  await mkdir(path.join(projectRoot, "review"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "review", "content-review.yaml"),
    stringifyYaml({ content: result.review.content }),
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "review", "visual-review.yaml"),
    stringifyYaml({ visual: result.review.visual }),
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "review", "technical-review.yaml"),
    stringifyYaml({ technical: result.review.technical }),
    "utf8",
  );

  // Run record
  const runId = formatRunId("review");
  const messages = [
    {
      role: "system" as const,
      content: "Review Agent system prompt (see @vf/review/src/agent.ts)",
    },
    {
      role: "user" as const,
      content: `Reviewing project: ${opts.project}`,
    },
  ];
  const record = {
    run_id: runId,
    stage: "review",
    status: "succeeded" as const,
    actor: "agent" as const,
    tool: "vf-review",
    input_commit: safeGitHead(projectRoot),
    input_files: [
      "storyboard/storyboard.yaml",
      "script/script.zh-CN.md",
      "research/claims.yaml",
    ],
    output_files: [
      "review/content-review.yaml",
      "review/visual-review.yaml",
      "review/technical-review.yaml",
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

  // Summary
  const overall = [
    result.review.content.overall,
    result.review.visual.overall,
    result.review.technical.overall,
  ];
  console.log(`\u2713 reviewed ${opts.project}/review/`);
  console.log(
    `  provider=${chosenName}  content=${overall[0]}  visual=${overall[1]}  technical=${overall[2]}`,
  );
  if (overall.some((v) => v !== "pass")) {
    console.log(
      `  note: one or more sections are warn/fail — review the YAML files before publishing`,
    );
  }
  return 0;
}

function stringifyYaml(value: unknown): string {
  return yamlStringify(value);
}

// Schema validation re-export for the test
export { ReviewPackageSchema, parseYaml };
