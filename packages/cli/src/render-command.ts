import type { Command } from "commander";
import { existsSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { resolveProjectDir, resolveProjectRoot } from "./project-path.js";
import {
  formatRunId,
  readProjectState,
  transition,
  writeProjectState,
  writeRun,
  type Stage,
  type WorkflowStatus,
} from "@video/workflow";
import { validateProject } from "@video/vdsl";
import { REGISTRY } from "@video/video-components";
import {
  faststart,
  loadOrCompileStoryboard,
  renderPlanToVideo,
} from "@video/video-renderer";

const STORYBOARD_REL = "storyboard/storyboard.yaml";
const VDSL_REL = "vdsl/vdsl.yaml";

export interface PreviewOptions {
  draft?: boolean | undefined;
}

export async function runPreview(
  projectName?: string,
  cwd?: string,
  force: boolean = false,
  opts: PreviewOptions = {},
): Promise<number> {
  // Two ways to identify the project:
  //   1. `projectName` (slug or human name) → look under `${cwd ?? "."}/projects/<slug>`
  //   2. neither → auto-discover from `${cwd ?? "."}/projects/*` via resolveProjectRoot
  let root: string;
  if (projectName) {
    const resolved = resolveProjectDir(projectName, cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return 1;
    }
    root = resolved.root;
  } else {
    const resolved = resolveProjectRoot(cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return 1;
    }
    root = resolved.root;
  }

  const { renderPreviewProject } = await import("@video/video-renderer");
  const outcome = await renderPreviewProject(root, {
    ...(force ? { force: true } : {}),
    ...(opts.draft !== undefined ? { draft: opts.draft } : {}),
    log: (l) => console.log(l),
  });
  for (const line of outcome.lines) {
    if (outcome.ok) console.log(line);
    else console.error(line);
  }
  for (const warning of outcome.warnings) console.warn(warning);
  if (!outcome.ok && outcome.error !== "") console.error(outcome.error);
  return outcome.ok ? 0 : 1;
}

export interface FinalOptions {
  cwd?: string;
  /** Project name (slug). When given, the project root is resolved as
   * `${cwd ?? "."}/projects/<slug>`. Mutually convenient with the project
   * positional arg on the CLI; cwd overrides it when both are present. */
  projectName?: string;
  /** When true, after rendering the bare mp4, run `video mix` to replace
   * `output/final-mixed.mp4` as the published artifact (narrration + BGM + SFX
   * cues per audio-assets/mix.yaml). */
  mix?: boolean;
  /** Bypass the QA gate (T6.2): render even when error-level QA findings
   * are present. Printed as [FORCE] and the failed gate stays in the run
   * history. */
  force?: boolean;
}

export async function runFinal(
  opts: FinalOptions | string = {},
): Promise<number> {
  // Back-compat: accept either a cwd string or an options object.
  const resolved: FinalOptions =
    typeof opts === "string" ? { cwd: opts } : opts;
  const projectResolved = resolveProjectRoot(resolved.cwd);
  if (!projectResolved.ok) {
    console.error(projectResolved.message);
    return 1;
  }
  const root = projectResolved.root;
  const state = await readProjectState(root);
  if (!state) return 1;
  if (state.current_stage !== "review" || state.status !== "APPROVED") {
    console.error(
      `final: requires review checkpoint APPROVED (current: ${state.current_stage} ${state.status})`,
    );
    return 1;
  }
  const { renderPlan } = await loadOrCompileStoryboard(root);

  // QA gate (T6.2, §24/Principle 7): the final render IS the export path.
  // Error-level findings against the preview artifact block it; --force is
  // the explicit bypass. Warn-level findings surface but don't block.
  const force = resolved.force === true;
  const qaVideo = [
    path.join(root, "output", "preview-faststart.mp4"),
    path.join(root, "output", "preview.mp4"),
  ].find((p) => existsSync(p));
  if (!qaVideo && !force) {
    console.error(
      `final: no preview artifact to QA — run \`video preview\` first (or --force to render un-QA'd)`,
    );
    return 1;
  }
  if (qaVideo) {
    const { writeQaArtifacts } = await import("@video/qa");
    const report = await writeQaArtifacts(root, renderPlan, qaVideo);
    const errors = report.findings.filter((f) => f.level === "error");
    if (!report.ok) {
      for (const f of report.findings) {
        console.error(`  [${f.level}] ${f.check}: ${f.message}`);
        if (f.fix) console.error(`         fix: ${f.fix}`);
      }
    }
    if (errors.length > 0 && !force) {
      const runId = formatRunId("final");
      await writeRun(root, {
        run_id: runId,
        stage: "final" as Stage,
        status: "failed",
        actor: "tool",
        tool: "qa-gate",
        input_commit: safeGitHead(root),
        input_files: [STORYBOARD_REL],
        output_files: [],
        created_at: new Date().toISOString(),
        duration_ms: 0,
        error: `qa-gate: ${errors.length} error-level finding(s) — see qa/render-report.json`,
      });
      console.error(
        `final: blocked by the QA gate (${errors.length} error(s)) — fix and re-run, or \`video final --force\` to override`,
      );
      return 1;
    }
    if (errors.length > 0 && force) {
      console.warn(
        `[FORCE] rendering final despite ${errors.length} QA error(s)`,
      );
    }
  }

  const out = path.join(root, "output", "final.mp4");
  await renderPlanToVideo(renderPlan, out);
  const faststartOut = path.join(root, "output", "final-faststart.mp4");
  await faststart(out, faststartOut);

  // Refresh QA artifacts against the shipped final (non-blocking — the
  // gate already ran pre-render).
  try {
    const { writeQaArtifacts: writeFinalQa } = await import("@video/qa");
    await writeFinalQa(root, renderPlan, out);
  } catch (err) {
    console.error(
      `  QA refresh failed (final is still valid): ${(err as Error).message}`,
    );
  }

  const runId = formatRunId("final");
  const start = Date.now();
  await writeRun(root, {
    run_id: runId,
    stage: "final" as Stage,
    status: "succeeded",
    actor: "tool",
    tool: "remotion",
    tool_version: "4.0.526",
    input_commit: safeGitHead(root),
    input_files: [
      STORYBOARD_REL,
      ...(existsSync(path.join(root, VDSL_REL)) ? [VDSL_REL] : []),
    ],
    output_files: ["output/final.mp4", "output/final-faststart.mp4"],
    created_at: new Date().toISOString(),
    duration_ms: Date.now() - start,
  });

  // APPROVED → FINAL_APPROVED via the machine (the precondition above
  // guarantees APPROVED, so this cannot throw — kept defensive anyway).
  let finalStatus: WorkflowStatus;
  try {
    const next = transition(
      { status: state.status, stage: state.current_stage },
      { kind: "final_approve" },
      { run_id: runId, actor: "tool" },
    );
    finalStatus = next.state.status;
  } catch (err) {
    console.error(`final: ${(err as Error).message}`);
    return 1;
  }
  state.status = finalStatus;
  state.current_stage = "final";
  state.checkpoint = { id: runId, status: finalStatus };
  await writeProjectState(root, state);
  console.log(`✓ final rendered: ${faststartOut}`);
  if (resolved.mix) {
    try {
      const { runMix } = await import("./mix-command.js");
      const mixCode = await runMix({ project: path.basename(root), cwd: root });
      if (mixCode !== 0) {
        console.error(
          `final: mix step exited ${mixCode}; bare narration mp4 is still at output/final-faststart.mp4`,
        );
        return mixCode;
      }
      console.log(
        `  audio: final-mixed.mp4 replaces narration-only mp4 as the published artifact`,
      );
    } catch (err) {
      console.error(`final: mix step threw:`, (err as Error).message);
      return 1;
    }
  }
  return 0;
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

// Re-export for convenience
export { validateProject, REGISTRY };

export function registerPreview(program: Command): void {
  program
    .command("preview")
    .argument(
      "[project]",
      "project name (slug) — optional if exactly one project exists under <cwd>/projects/",
    )
    .option(
      "--cwd <dir>",
      "project root (used as base when [project] is given, or auto-discovered from)",
    )
    .option(
      "--force",
      "render even when the storyboard checkpoint is not approved (prints [FORCE] warning and records it in the audit trail)",
    )
    .option(
      "--draft",
      "draft quality: 960x540@15 for fast iteration (plan §27); final still renders 1080p30",
    )
    .action(
      async (
        project: string | undefined,
        opts: { cwd?: string; force?: boolean; draft?: boolean },
      ) => {
        process.exitCode = await runPreview(project, opts.cwd, opts.force, {
          draft: opts.draft,
        });
      },
    );
}

export function registerFinal(program: Command): void {
  program
    .command("final")
    .argument("[project]", "project name (slug) — optional")
    .option("--cwd <dir>", "project root")
    .option(
      "--mix",
      "after rendering, run video mix to produce final-mixed.mp4 with narration + BGM + SFX cues",
    )
    .option(
      "--force",
      "render even when the QA gate reports error-level findings (prints [FORCE] warning; the failed gate stays in the run history)",
    )
    .action(
      async (
        project: string | undefined,
        opts: { cwd?: string; mix?: boolean; force?: boolean },
      ) => {
        process.exitCode = await runFinal({
          ...(project ? { projectName: project } : {}),
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.mix === true ? { mix: true } : {}),
          ...(opts.force === true ? { force: true } : {}),
        });
      },
    );
}
