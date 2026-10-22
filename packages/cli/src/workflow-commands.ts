import type { Command } from "commander";
import path from "node:path";
import { existsSync } from "node:fs";
import { resolveProjectDir, resolveProjectRoot } from "./project-path.js";
import {
  approveCheckpoint,
  lastSuccessfulStage,
  readProjectState,
  rejectCheckpoint,
  resetProject,
  rollbackToCheckpoint,
  type WorkflowCommandResult,
} from "@video/workflow";

/** Resolve a project argument (name or implicit cwd) to its root —
 *  the shared prologue of every workflow verb. */
async function rootOf(
  projectName: string | undefined,
  cwd: string | undefined,
): Promise<string | number> {
  const resolved = projectName
    ? resolveProjectDir(projectName, cwd)
    : resolveProjectRoot(cwd);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  return resolved.root;
}

function printResult(result: WorkflowCommandResult): number {
  for (const line of result.lines ?? []) console.log(line);
  if (result.ok) {
    for (const warning of result.warnings ?? []) console.warn(warning);
  } else if (result.error !== "") {
    console.error(result.error);
  }
  return result.ok ? 0 : 1;
}

export async function runApprove(
  projectName: string | undefined,
  stage: string | undefined,
  cwd: string | undefined,
  force: boolean = false,
): Promise<number> {
  // v0.8 (G4): `video approve visuals <project>` freezes the current
  // image set into checkpoints/visuals.yaml — deliberately NOT a workflow
  // stage (V01_STAGES is frozen; plan D1), so it short-circuits here.
  if (stage === "visuals") {
    if (projectName === undefined) {
      console.error("approve visuals: missing <project> argument");
      return 1;
    }
    const { approveVisualsCheckpointCli } =
      await import("./visuals-command.js");
    return approveVisualsCheckpointCli(projectName, cwd);
  }
  const root = await rootOf(projectName, cwd);
  if (typeof root === "number") return root;
  return printResult(
    await approveCheckpoint(root, {
      ...(stage !== undefined ? { stage } : {}),
      force,
    }),
  );
}

export async function runReject(
  projectName: string | undefined,
  reasonCode: string,
  cwd: string | undefined,
): Promise<number> {
  const root = await rootOf(projectName, cwd);
  if (typeof root === "number") return root;
  return printResult(await rejectCheckpoint(root, reasonCode));
}

export async function runRollback(
  projectName: string | undefined,
  checkpointId: string,
  cwd: string | undefined,
): Promise<number> {
  const root = await rootOf(projectName, cwd);
  if (typeof root === "number") return root;
  return printResult(
    await rollbackToCheckpoint(root, checkpointId, async (preview) => {
      for (const line of preview) console.log(line);
      console.log("Continue? [y/N]");
      return (await readLine()).toLowerCase() === "y";
    }),
  );
}

export async function runResume(
  projectName: string | undefined,
  cwd: string | undefined,
): Promise<number> {
  const root = await rootOf(projectName, cwd);
  if (typeof root === "number") return root;
  const state = await readProjectState(root);
  if (!state) return 1;
  if (state.status === "FINAL_APPROVED") {
    console.log(
      `resume: project is FINAL_APPROVED — nothing to resume (rework with \`video reset --force\`)`,
    );
    return 0;
  }
  const last = await lastSuccessfulStage(root);

  // Make-flow project (article.md is its source of truth): the pipeline is
  // idempotent — steps whose outputs are newer than their inputs are
  // skipped, so re-running it completes an interrupted run (§25 resume,
  // not restart). Human gates still apply: the render step stops at the
  // approve gate and prints the approve command.
  if (existsSync(path.join(root, "article.md"))) {
    console.log(
      `resume: make-flow project (last successful stage: ${last ?? "none"}, status ${state.status}) — re-running the idempotent pipeline`,
    );
    const { runMake } = await import("@video/make");
    try {
      const makeReport = await runMake({ projectRoot: root });
      const failed = makeReport.steps.filter((s) => s.status === "fail");
      if (failed.length > 0) {
        for (const s of failed)
          console.error(`  failed step: ${s.name} — ${s.message ?? ""}`);
        return 1;
      }
      console.log(
        `✓ resume complete: ${makeReport.outputFiles.length} output(s)`,
      );
      return 0;
    } catch (err) {
      console.error(`resume: pipeline failed: ${(err as Error).message}`);
      return 1;
    }
  }

  // CLI-flow project: resume from the recorded state — print where we are
  // and the exact next command (§25: resume, not restart).
  const next: Record<string, string> = {
    init: "video storyboard <topic> --cwd .  (or video script / video research first)",
    storyboard: "video audio <project>  (then video review, video preview)",
    review: "video approve review --cwd .  (then video final)",
    final: "video youtube <project>  (publishing metadata)",
  };
  console.log(
    `Resume from stage ${state.current_stage} at status ${state.status} (last successful run stage: ${last ?? "none"}).`,
  );
  console.log(
    `  next: ${next[state.current_stage] ?? "video status for details"}`,
  );
  return 0;
}

export async function runReset(
  projectName: string | undefined,
  toStage: string | undefined,
  cwd: string | undefined,
  force: boolean = false,
): Promise<number> {
  const root = await rootOf(projectName, cwd);
  if (typeof root === "number") return root;
  return printResult(
    await resetProject(root, {
      ...(toStage !== undefined ? { toStage } : {}),
      force,
    }),
  );
}

async function readLine(): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question("")).trim();
  } finally {
    rl.close();
  }
}

export function registerWorkflow(program: Command): void {
  program
    .command("approve")
    .argument("[stage]", "stage to approve (defaults to current_stage)")
    .argument("[project]", "project name (slug) — optional")
    .option("--cwd <dir>", "project root")
    .option(
      "--force",
      "bypass state-machine legality check (emergency use only); prints [FORCE] warning and records [forced] in audit trail",
    )
    .action(
      async (
        stage: string | undefined,
        project: string | undefined,
        opts: { cwd?: string; force?: boolean },
      ) => {
        process.exitCode = await runApprove(
          project,
          stage,
          opts.cwd,
          opts.force,
        );
      },
    );

  program
    .command("reject")
    .argument("[project]", "project name (slug) — optional")
    .argument("[reason]", "reason code (e.g. wrong-content, wrong-pacing)")
    .option("--cwd <dir>", "project root")
    .action(
      async (
        project: string | undefined,
        reason: string | undefined,
        opts: { cwd?: string },
      ) => {
        // One-argument form: `video reject wrong-content` — the arg is the
        // reason, the project auto-discovers (documented usage).
        if (reason === undefined && project !== undefined) {
          reason = project;
          project = undefined;
        }
        if (reason === undefined) {
          console.error(
            "reject: missing reason (e.g. video reject wrong-content)",
          );
          process.exitCode = 1;
          return;
        }
        process.exitCode = await runReject(project, reason, opts.cwd);
      },
    );

  program
    .command("rollback")
    .argument("[project]", "project name (slug) — optional")
    .argument("[checkpoint-id]", "checkpoint to roll back to")
    .option("--cwd <dir>", "project root")
    .action(
      async (
        project: string | undefined,
        id: string | undefined,
        opts: { cwd?: string },
      ) => {
        // One-argument form: `video rollback <checkpoint-id>` — auto-discovers
        // the project (documented usage; optional-before-required would
        // otherwise make this form unparsable).
        if (id === undefined && project !== undefined) {
          id = project;
          project = undefined;
        }
        if (id === undefined) {
          console.error(
            "rollback: missing checkpoint-id (video rollback <id>)",
          );
          process.exitCode = 1;
          return;
        }
        process.exitCode = await runRollback(project, id, opts.cwd);
      },
    );

  program
    .command("resume")
    .argument("[project]", "project name (slug) — optional")
    .option("--cwd <dir>", "project root")
    .action(async (project: string | undefined, opts: { cwd?: string }) => {
      process.exitCode = await runResume(project, opts.cwd);
    });

  program
    .command("reset")
    .argument("[project]", "project name (slug) — optional")
    .argument(
      "[to-stage]",
      "stage to set current_stage to after reset (default: init; one of init|storyboard|compile|render|review|final)",
    )
    .option("--cwd <dir>", "project root")
    .option(
      "--force",
      "rewind even when the project is in FINAL_APPROVED (the only state from which reset normally refuses); prints [FORCE] warning and records [forced] in audit trail",
    )
    .action(
      async (
        project: string | undefined,
        toStage: string | undefined,
        opts: { cwd?: string; force?: boolean },
      ) => {
        process.exitCode = await runReset(
          project,
          toStage,
          opts.cwd,
          opts.force,
        );
      },
    );
}
