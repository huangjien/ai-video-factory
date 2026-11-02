import type { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { resolveProjectDir } from "./project-path.js";
import { existsSync, readFileSync } from "node:fs";
import {
  GLMProvider,
  judgePickForName,
  loadProviderConfig,
  MiniMaxProvider,
  pickJudgeProvider,
} from "@video/llm";
import { callReview, ReviewPackageSchema } from "@video/review";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import type { ChatMessage, Provider } from "@video/llm";
import { formatRunId } from "@video/workflow";
import { MARK_FAIL, MARK_OK, brandBannerLine, channelHeader } from "./ui.js";

export interface ReviewOptions {
  project: string;
  cwd?: string | undefined;
  model?: "minimax" | "glm" | undefined;
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

/** The project's narration language.
 *
 *  `video script` names its output by language (`script.en-US.md` /
 *  `script.zh-CN.md`), so anything that has to FIND that file must know
 *  the language too — a hardcoded `script.zh-CN.md` made every en-US
 *  project unreviewable.
 *
 *  Order: the storyboard's `project.language` (derived from article.md,
 *  the source of truth) → article.md frontmatter → project.yaml → zh-CN.
 *  project.yaml alone is not enough: `video new` writes the scaffold
 *  default there and never updates it, so an en-US project still says
 *  zh-CN. */
function projectLanguage(projectRoot: string, storyboardYaml: string): string {
  try {
    const parsed = parseYaml(storyboardYaml) as {
      project?: { language?: unknown };
    };
    const lang = parsed.project?.language;
    if (typeof lang === "string" && lang.trim() !== "") return lang.trim();
  } catch {
    /* unparseable storyboard → fall through to the other sources */
  }
  try {
    const md = readFileSync(path.join(projectRoot, "article.md"), "utf8");
    const m = md.match(/^language:\s*(.+)$/m);
    const lang = m?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (lang !== undefined && lang !== "") return lang;
  } catch {
    /* no article.md → fall through */
  }
  try {
    const meta = parseYaml(
      readFileSync(path.join(projectRoot, "project.yaml"), "utf8"),
    ) as { language?: unknown };
    if (typeof meta.language === "string" && meta.language.trim() !== "") {
      return meta.language.trim();
    }
  } catch {
    /* no project.yaml → fall through */
  }
  return "zh-CN";
}

/** Candidate script filenames for a language, most specific first.
 *  `video script` writes exactly `script.en-US.md` for en-US and
 *  `script.zh-CN.md` for everything else. */
function scriptFileCandidates(lang: string): string[] {
  return lang === "en-US"
    ? ["script.en-US.md"]
    : [`script.${lang}.md`, "script.zh-CN.md"];
}

/** Provenance note sent to the judge when the script slot is filled by
 *  article.md — the judge must know it is reading the article, not a
 *  missing file, or it may report the substitution as a defect. */
const ARTICLE_AS_SCRIPT_NOTE =
  "The script artifact for this project is `article.md` — this project was produced by `video draft`, which writes no separate script file. It carries the narration, captions and prose for every scene.";

/** Sent to the judge when the project has no claims artifact, so it
 *  reports unverifiable claims as unverifiable instead of as errors. */
const NO_CLAIMS_NOTE =
  "This project has no claims artifact (no `video research` run). Do not assert independent factual verification — report material claims as unverifiable rather than as errors.";

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
  const resolvedProject = resolveProjectDir(opts.project, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    return 1;
  }
  const projectRoot = resolvedProject.root;
  const { readFile } = await import("node:fs/promises");
  const sbPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
  const claimsPath = path.join(projectRoot, "research", "claims.yaml");
  const articlePath = path.join(projectRoot, "article.md");
  // The storyboard is the only REQUIRED input: it is the film itself.
  // The script and the claims file belong to the script/research
  // pipeline; `video draft` writes neither, so demanding them made the
  // command unusable on every drafted project.
  if (!existsSync(sbPath)) {
    console.error(`missing input: ${sbPath}`);
    console.error(`  run video draft / video storyboard first`);
    return 1;
  }
  const storyboard = await readFile(sbPath, "utf8");
  const lang = projectLanguage(projectRoot, storyboard);

  // Script: the script-pipeline's file if it exists, else article.md
  // (which carries the same narration for a drafted project), else a
  // note that says so.
  const scriptPath = scriptFileCandidates(lang)
    .map((f) => path.join(projectRoot, "script", f))
    .find((p) => existsSync(p));
  let script: string;
  let scriptFile: string;
  if (scriptPath !== undefined) {
    script = await readFile(scriptPath, "utf8");
    scriptFile = path.relative(projectRoot, scriptPath);
  } else if (existsSync(articlePath)) {
    script = `${ARTICLE_AS_SCRIPT_NOTE}\n\n${await readFile(articlePath, "utf8")}`;
    scriptFile = "article.md";
  } else {
    script = "(no script artifact for this project)";
    scriptFile = "";
  }

  // Claims: optional. Absent, the judge is told to report claims as
  // unverifiable rather than as errors.
  const hasClaims = existsSync(claimsPath);
  const claims = hasClaims
    ? await readFile(claimsPath, "utf8")
    : NO_CLAIMS_NOTE;
  const claimsFile = hasClaims
    ? path.relative(projectRoot, claimsPath)
    : "";

  const cfg = loadProviderConfig();
  // 2026-10-26: read the REVIEW role for judge slots — this used to read
  // cfg["research"], a latent bug that silently ignored `review:`
  // overrides in llm.config.yaml (defaults coincided, so behavior looked
  // right). Cross-model guard: flip off the storyboard role's provider,
  // the pipeline's generator for the artifact being reviewed.
  const judgePick = opts.model
    ? judgePickForName(opts.model, cfg)
    : pickJudgeProvider(cfg, cfg["storyboard"].primary);
  const chosenName = judgePick.name;
  if (judgePick.flipped) {
    console.error(
      `  ! review flipped to ${chosenName} — it must not run on the storyboard generator's provider (${cfg["storyboard"].primary})`,
    );
  }
  if (chosenName === cfg["storyboard"].primary) {
    console.error(
      `  ! WARNING: review = storyboard generator = ${chosenName} — self-judged (fix review: in llm config or pass --model)`,
    );
  }
  const provider = providerInstance(chosenName);
  const fallback = judgePick.fallback
    ? providerInstance(judgePick.fallback)
    : null;

  let result;
  try {
    result = await callReview(
      { storyboard, script, claims },
      provider,
      fallback,
    );
  } catch (err) {
    console.error(
      `${MARK_FAIL} ${chosenName} review agent failed:`,
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

  // Run record — model reflects the SERVING provider (may differ from the
  // chosen one after failover) and prompt_hash hashes the messages the
  // agent actually sent (result.messages), not a reconstructed placeholder.
  const runId = formatRunId("review");
  const servedModel = modelFor(result.providerName);
  const record = {
    run_id: runId,
    stage: "review",
    status: "succeeded" as const,
    actor: "agent" as const,
    tool: "video-review",
    input_commit: safeGitHead(projectRoot),
    input_files: [
      "storyboard/storyboard.yaml",
      ...(scriptFile !== "" ? [scriptFile] : []),
      ...(claimsFile !== "" ? [claimsFile] : []),
    ],
    output_files: [
      "review/content-review.yaml",
      "review/visual-review.yaml",
      "review/technical-review.yaml",
    ],
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

  // Summary
  const overall = [
    result.review.content.overall,
    result.review.visual.overall,
    result.review.technical.overall,
  ];
  const verdict = overall.every((v) => v === "pass") ? "pass" : "warn";
  console.log(brandBannerLine());
  console.log(
    channelHeader(opts.project, `review · ${verdict} · ${result.providerName}`),
  );
  console.log("");
  console.log(`${MARK_OK} wrote review/{content,visual,technical}-review.yaml`);
  console.log(
    `  content=${overall[0]}  visual=${overall[1]}  technical=${overall[2]}`,
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

export function registerReview(program: Command): void {
  program
    .command("review")
    .argument(
      "<project>",
      "project to review: topic, folder name, path, or unique prefix",
    )
    .option("--cwd <dir>", "base directory for the project")
    .option(
      "--model <provider>",
      "model provider: minimax|glm (default: research-role config)",
    )
    .action(
      async (
        project: string,
        opts: { cwd?: string; model?: "minimax" | "glm" },
      ) => {
        process.exitCode = await runReview({
          project,
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.model !== undefined ? { model: opts.model } : {}),
        });
      },
    );
}
