/**
 * v0.4 (T10) — `vf retrospect` learning loop.
 *
 * Reads the last few run records + the latest QA report from a project,
 * hands them to the LLM with a "suggest 3 concrete edits to article.md"
 * prompt, and writes the result to `retrospect.md`. Records a run.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  GLMProvider,
  MiniMaxProvider,
  loadProviderConfig,
  type Provider,
  type ChatMessage,
} from "@vf/llm";
import { chatWithFallback } from "@vf/llm";
import { listRuns, formatRunId, type RunRecord } from "@vf/workflow";
import { resolveProjectDir } from "./project-path.js";

export interface RetrospectOptions {
  project: string;
  cwd?: string;
  /** v0.4 (T10): when true, skip the LLM call — just print the
   *  cached `retrospect.md`. */
  dryRun?: boolean;
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unsupported provider: ${name}`);
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const SYSTEM_PROMPT = `You are the Retrospect Agent for the AI Video Factory.

Given a project's run history (provider, tokens, cost) and its latest QA
findings, suggest exactly THREE concrete edits the user can make to
article.md to improve the next render. Each suggestion must cite a
specific scene id, caption text, or frontmatter key. No fluff.

Output ONE fenced YAML code block (\`\`\`yaml ... \`\`\`) with EXACTLY:
  suggestions: list of {scene: string, action: string, expected_gain: string}

Constraints:
- scene — either a scene id like "scene-03" or "all".
- action — one short imperative sentence ("shorten scene-04 caption from 18 to 8 chars").
- expected_gain — concrete ("captions fit on screen" / "scene-audio drift reduced below 0.15s").
- No prose, no markdown outside the YAML block.`;

/** Build the prompt from real on-disk evidence so the LLM has something
 *  concrete to react to. */
function buildRetrospectMessages(
  recent: RunRecord[],
  qaFindings: string[],
  articleExcerpt: string,
): ChatMessage[] {
  const userParts: string[] = [];
  userParts.push("## Recent run history (last 5, most recent first)");
  for (const r of recent) {
    userParts.push(
      `- ${r.created_at} | stage=${r.stage} | provider=${r.provider ?? "n/a"} | model=${r.model ?? "n/a"} | tokens=${r.tokens?.input ?? 0}+${r.tokens?.output ?? 0} | cost=$${(r.estimated_cost_usd ?? 0).toFixed(4)} | status=${r.status}`,
    );
  }
  userParts.push("");
  userParts.push("## Latest QA findings (level | check | message | fix)");
  for (const f of qaFindings) userParts.push(`- ${f}`);
  userParts.push("");
  userParts.push("## Article excerpt (first 1500 chars)");
  userParts.push(articleExcerpt);
  userParts.push("");
  userParts.push("Suggest exactly 3 concrete edits to article.md.");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}

/** Pull last N successful runs + their token/cost deltas. */
async function gatherEvidence(projectRoot: string): Promise<{
  recent: RunRecord[];
  qaFindings: string[];
  articleExcerpt: string;
}> {
  const all = await listRuns(projectRoot);
  const recent = all.slice(-5).reverse();

  const qaFindings: string[] = [];
  const reportPath = path.join(projectRoot, "qa", "render-report.json");
  if (existsSync(reportPath)) {
    try {
      const raw = await readFile(reportPath, "utf8");
      const parsed = parseYaml(raw) as {
        findings?: {
          level?: string;
          check?: string;
          message?: string;
          fix?: string;
        }[];
      };
      for (const f of parsed.findings ?? []) {
        qaFindings.push(
          `${f.level ?? "?"} | ${f.check ?? "?"} | ${f.message ?? ""}${f.fix ? ` | fix: ${f.fix}` : ""}`,
        );
      }
    } catch {
      /* corrupt report — leave qaFindings empty */
    }
  }

  let articleExcerpt = "(article.md not found)";
  const articlePath = path.join(projectRoot, "article.md");
  if (existsSync(articlePath)) {
    try {
      const md = await readFile(articlePath, "utf8");
      articleExcerpt = md.slice(0, 1500);
    } catch {
      /* unreadable — leave default */
    }
  }

  return { recent, qaFindings, articleExcerpt };
}

const SUGGESTIONS_RE = /```(?:yaml)?\s*([\s\S]*?)```/;

export function extractSuggestions(content: string): string {
  const m = content.match(SUGGESTIONS_RE);
  return (m?.[1] ?? content).trim();
}

export async function runRetrospect(
  opts: RetrospectOptions,
): Promise<number> {
  const resolved = resolveProjectDir(opts.project, opts.cwd);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const projectRoot = resolved.root;

  const evidence = await gatherEvidence(projectRoot);
  const messages = buildRetrospectMessages(
    evidence.recent,
    evidence.qaFindings,
    evidence.articleExcerpt,
  );

  const cfg = loadProviderConfig();
  const reviewCfg = cfg["review"];
  const chosenName = reviewCfg.primary;
  const provider = providerInstance(chosenName);
  const fallbackName = reviewCfg.fallback;
  const fallback = fallbackName ? providerInstance(fallbackName) : null;

  let responseText: string;
  let providerName: string;
  let usage = { input: 0, output: 0 };

  if (opts.dryRun) {
    console.log(`dry-run: would prompt LLM with ${messages.length} messages`);
    console.log(
      `  evidence: ${evidence.recent.length} runs, ${evidence.qaFindings.length} findings, ${evidence.articleExcerpt.length} chars of article`,
    );
    return 0;
  }

  try {
    const out = await chatWithFallback(provider, fallback, { messages });
    responseText = out.response.content;
    providerName = out.provider;
    usage = out.response.usage;
  } catch (err) {
    console.error(`\u2717 retrospect LLM failed: ${(err as Error).message}`);
    return 1;
  }

  const yaml = extractSuggestions(responseText);
  const dated = new Date().toISOString();
  const header =
    `<!-- generated ${dated} by ${providerName} -->\n` +
    `# Retrospect — what to fix in article.md before the next render\n\n`;
  const out = `${header}${yaml}\n`;
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "retrospect.md"), out, "utf8");

  // Run record
  const runId = formatRunId("retrospect");
  const record: RunRecord = {
    run_id: runId,
    stage: "retrospect",
    status: "succeeded",
    actor: "agent",
    tool: providerName,
    input_commit: safeGitHead(projectRoot),
    input_files: ["runs/", "qa/render-report.json"],
    output_files: ["retrospect.md"],
    created_at: dated,
    duration_ms: 0,
    provider: providerName,
    model: "retrospect-v0.4",
    prompt_hash:
      "sha256:" +
      createHash("sha256")
        .update(messages.map((m) => `${m.role}:${m.content}`).join("\n"))
        .digest("hex"),
    tokens: usage,
    estimated_cost_usd: ((usage.input + usage.output) / 1000) * 0.001,
  };
  const { writeRun } = await import("@vf/workflow");
  await writeRun(projectRoot, record);

  console.log(`\u2713 wrote projects/${opts.project}/retrospect.md`);
  console.log(
    `  provider=${providerName}  tokens=${usage.input}+${usage.output}  next: edit article.md per the suggestions, then \`vf draft <topic> --from article.md\``,
  );
  return 0;
}