import path from "node:path";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolveProjectDir, resolveProjectRoot } from "./project-path.js";
import {
  appendCheckpoint,
  invalidateCheckpoint,
  lastSuccessfulStage,
  listCheckpoints,
  loadCheckpoint,
  readProjectState,
  stagesInvalidatedBy,
  transition,
  V01_STAGES,
  writeProjectState,
  type MachineState,
} from "@video/workflow";

export async function runApprove(
  projectName: string | undefined,
  stage: string | undefined,
  cwd: string | undefined,
  force: boolean = false,
): Promise<number> {
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
  const target = (
    stage ??
    (await readProjectState(root))?.current_stage ??
    ""
  ).trim();
  if (!target) {
    console.error("approve: could not determine stage");
    return 1;
  }
  if (!(V01_STAGES as readonly string[]).includes(target)) {
    console.error(`approve: unknown stage "${target}"`);
    return 1;
  }
  // Approving implies the stage's artifact was actually reviewed.
  if (target === "storyboard" && !existsSync(path.join(root, "storyboard", "storyboard.yaml"))) {
    console.error(
      `approve: no storyboard at ${root}/storyboard/storyboard.yaml — nothing to approve`,
    );
    return 1;
  }
  const state = await readProjectState(root);
  if (!state) return 1;
  const machineState: MachineState = {
    status: state.status,
    stage: state.current_stage,
  };
  let next: ReturnType<typeof transition>;
  try {
    if (target === "final") {
      next = transition(
        machineState,
        { kind: "final_approve" },
        ctx("approve-final"),
      );
    } else {
      next = transition(
        machineState,
        { kind: "approve", ...(force ? { force: true } : {}) },
        ctx(`approve-${target}`),
      );
    }
  } catch (err) {
    if (force) {
      console.error(
        `[FORCE] cannot approve ${target}: ${(err as Error).message}`,
      );
      console.error(
        `[FORCE] target status was ${state.status} — even --force respects the terminal FINAL_APPROVED state`,
      );
    } else {
      console.error(`approve: ${(err as Error).message}`);
    }
    return 1;
  }
  if (force) {
    console.warn(
      `[FORCE] ${target} approved from ${state.status}`,
    );
  }
  state.status = next.state.status;
  state.checkpoint = { id: state.checkpoint.id, status: next.state.status };
  await writeProjectState(root, state);
  await appendCheckpoint(root, {
    id: `${target}-${next.record.run_id}`,
    stage: target as (typeof V01_STAGES)[number],
    status: "approved",
    created_at: next.record.at,
    approved_at: next.record.at,
    human_changes: [],
    notes: force ? "force-approved via video approve --force" : "approved via video approve",
  });
  console.log(`Checkpoint ${target} approved.`);
  return 0;
}

export async function runReject(
  projectName: string | undefined,
  reasonCode: string,
  cwd: string | undefined,
): Promise<number> {
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
  const state = await readProjectState(root);
  if (!state) return 1;
  const machineState: MachineState = {
    status: state.status,
    stage: state.current_stage,
  };
  const next = transition(
    machineState,
    { kind: "regenerate" },
    ctx(`reject-${reasonCode}`),
  );
  state.status = next.state.status;
  await writeProjectState(root, state);
  const cp = await loadCheckpoint(root, state.current_stage);
  if (cp) {
    cp.status = "rejected";
    cp.human_changes = [...cp.human_changes, `rejected: ${reasonCode}`];
    await appendCheckpoint(root, cp);
  }
  console.log(`rejected: ${reasonCode}`);
  return 0;
}

export async function runRollback(
  projectName: string | undefined,
  checkpointId: string,
  cwd: string | undefined,
): Promise<number> {
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
  const state = await readProjectState(root);
  if (!state) return 1;

  // Resolve the checkpoint id against the project's checkpoints and run
  // records — an unknown id must be rejected, not "rolled back to".
  const checkpoints = await listCheckpoints(root);
  const target = checkpoints.find((cp) => cp.id === checkpointId);
  if (!target) {
    console.error(`rollback: unknown checkpoint "${checkpointId}"`);
    const ids = checkpoints.map((cp) => `  ${cp.id}  (${cp.stage}, ${cp.status})`);
    if (ids.length > 0) console.error(`available checkpoints:\n${ids.join("\n")}`);
    else console.error("  (no checkpoints recorded yet)");
    return 1;
  }
  const targetStage = target.stage;
  const downstream = stagesInvalidatedBy(targetStage);

  if (state.status === "FINAL_APPROVED") {
    console.error(
      `rollback: project is FINAL_APPROVED (terminal) — run \`video reset --force\` to rework it`,
    );
    return 1;
  }

  // §18.2: show the target checkpoint, the stages that will be invalidated,
  // and require confirmation. Rollback never overwrites artifacts — content
  // stays; downstream stages just have to re-run.
  console.log(`Rollback to checkpoint ${target.id}`);
  console.log(`  stage:            ${targetStage} (created ${target.created_at})`);
  console.log(`  invalidated:      ${downstream.join(", ") || "nothing downstream"}`);
  console.log(`  content on disk:  untouched (§18.2) — downstream stages re-run from it`);
  if (targetStage === "storyboard") {
    console.log(`  scene edits:      use \`video scene list\` / \`video scene restore\` for per-scene content`);
  }
  console.log(`Continue? [y/N]`);
  const answer = await readLine();
  if (answer.toLowerCase() !== "y") {
    console.log("aborted");
    return 0;
  }

  const machineState: MachineState = {
    status: state.status,
    stage: state.current_stage,
  };
  let rolled;
  try {
    rolled = transition(machineState, { kind: "rollback", toCheckpoint: target.id }, ctx(`rollback-${target.id}`));
  } catch (err) {
    console.error(
      `rollback: ${(err as Error).message} — from ${state.status}, use \`video reset\` instead`,
    );
    return 1;
  }
  // ROLLED_BACK is transient (its only exit is DRAFT): continue through the
  // legal reset edge so the project lands at DRAFT / target stage instead
  // of wedging.
  const resetDone = transition(
    rolled.state,
    { kind: "reset" },
    ctx(`rollback-land-${target.id}`),
  );
  state.status = resetDone.state.status;
  state.current_stage = targetStage;
  state.checkpoint = { id: target.id, status: resetDone.state.status };
  await writeProjectState(root, state);

  for (const stage of downstream) {
    await invalidateCheckpoint(root, stage, `invalidated by rollback to ${target.id}`);
  }
  const { writeRun, formatRunId } = await import("@video/workflow");
  await writeRun(root, {
    run_id: formatRunId("rollback"),
    stage: "rollback",
    status: "succeeded",
    actor: "human",
    tool: "video-rollback",
    input_commit: safeGitHeadCli(root),
    input_files: [`checkpoints/${targetStage}.yaml`],
    output_files: [],
    created_at: new Date().toISOString(),
    duration_ms: 0,
  });
  console.log(`✓ rolled back to ${target.id} — state ${state.status} / ${state.current_stage}`);
  console.log(
    `  next: re-run the invalidated stages (e.g. \`video preview --force\` after edits, or \`video make\`), then re-approve`,
  );
  return 0;
}

function safeGitHeadCli(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export async function runResume(
  projectName: string | undefined,
  cwd: string | undefined,
): Promise<number> {
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
      const report = await runMake({ projectRoot: root });
      const failed = report.steps.filter((s) => s.status === "fail");
      if (failed.length > 0) {
        for (const s of failed) console.error(`  failed step: ${s.name} — ${s.message ?? ""}`);
        return 1;
      }
      console.log(`✓ resume complete: ${report.outputFiles.length} output(s)`);
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
  console.log(`  next: ${next[state.current_stage] ?? "video status for details"}`);
  return 0;
}

export async function runReset(
  projectName: string | undefined,
  toStage: string | undefined,
  cwd: string | undefined,
  force: boolean = false,
): Promise<number> {
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
  const target = (toStage ?? "init").trim();
  if (!(V01_STAGES as readonly string[]).includes(target)) {
    console.error(`reset: unknown stage "${target}"`);
    return 1;
  }
  const state = await readProjectState(root);
  if (!state) {
    console.error("reset: no project state found; nothing to reset");
    return 1;
  }
  const machineState: MachineState = {
    status: state.status,
    stage: state.current_stage,
  };
  let next: ReturnType<typeof transition>;
  try {
    next = transition(
      machineState,
      { kind: "reset", ...(force ? { force: true } : {}) },
      ctx("reset-to-" + target),
    );
  } catch (err) {
    if (force) {
      console.error(`[FORCE] cannot reset: ${(err as Error).message}`);
    } else {
      console.error(`reset: ${(err as Error).message}`);
      console.error(
        `reset: if the project is in FINAL_APPROVED, pass --force to rewind anyway`,
      );
    }
    return 1;
  }
  if (force) {
    console.warn(
      `[FORCE] resetting ${state.status} → DRAFT, current_stage=${state.current_stage} → ${target}`,
    );
  } else {
    console.warn(
      `reset: ${state.status} → DRAFT, current_stage=${state.current_stage} → ${target}`,
    );
  }
  state.status = next.state.status;
  state.current_stage = target as (typeof V01_STAGES)[number];
  state.checkpoint = { id: state.checkpoint.id, status: next.state.status };
  await writeProjectState(root, state);
  // The prior checkpoint at the target stage is stale after a rewind —
  // mark it invalidated instead of writing a fake "approved" record over it.
  await invalidateCheckpoint(
    root,
    target as (typeof V01_STAGES)[number],
    force ? "invalidated by video reset --force" : "invalidated by video reset",
  );
  console.log(`Project reset to DRAFT / ${target}.`);
  console.log(
    `next: re-run the pipeline (e.g. \`video storyboard ...\` or \`video audio ...\`)`,
  );
  return 0;
}

function ctx(runId: string) {
  return { run_id: runId, actor: "human" as const };
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
