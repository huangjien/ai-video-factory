import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { V01_STAGES } from "./states.js";
import { transition, type MachineState } from "./machine.js";
import { stagesInvalidatedBy } from "./invalidation.js";
import {
  appendCheckpoint,
  invalidateCheckpoint,
  listCheckpoints,
  loadCheckpoint,
  readProjectState,
  writeProjectState,
} from "./project.js";
import { formatRunId, writeRun } from "./runs.js";

/** Result of a workflow command. The CLI layer resolves the project,
 *  prints `lines`/`warnings`/`error`, and maps `ok` to the exit code —
 *  no presentation lives here. */
export type WorkflowCommandResult =
  | { ok: true; lines: string[]; warnings?: string[] }
  | { ok: false; error: string; lines?: string[] };

function ctx(runId: string) {
  return { run_id: runId, actor: "human" as const };
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function machineStateOf(state: {
  status: MachineState["status"];
  current_stage: string;
}): MachineState {
  return { status: state.status, stage: state.current_stage as MachineState["stage"] };
}

/** Approve a checkpoint (the human gate). `stage` defaults to the
 *  project's current_stage; `force` bypasses legality but never the
 *  terminal FINAL_APPROVED state. */
export async function approveCheckpoint(
  root: string,
  opts: { stage?: string; force?: boolean } = {},
): Promise<WorkflowCommandResult> {
  const target = (
    opts.stage ??
    (await readProjectState(root))?.current_stage ??
    ""
  ).trim();
  if (!target) return { ok: false, error: "approve: could not determine stage" };
  if (!(V01_STAGES as readonly string[]).includes(target)) {
    return { ok: false, error: `approve: unknown stage "${target}"` };
  }
  // Approving implies the stage's artifact was actually reviewed.
  if (
    target === "storyboard" &&
    !existsSync(path.join(root, "storyboard", "storyboard.yaml"))
  ) {
    return {
      ok: false,
      error: `approve: no storyboard at ${root}/storyboard/storyboard.yaml — nothing to approve`,
    };
  }
  const state = await readProjectState(root);
  if (!state) return { ok: false, error: "" };

  const warnings: string[] = [];
  let next: ReturnType<typeof transition>;
  try {
    if (target === "final") {
      next = transition(
        machineStateOf(state),
        { kind: "final_approve" },
        ctx("approve-final"),
      );
    } else {
      next = transition(
        machineStateOf(state),
        { kind: "approve", ...(opts.force ? { force: true } : {}) },
        ctx(`approve-${target}`),
      );
    }
  } catch (err) {
    if (opts.force) {
      return {
        ok: false,
        error: `[FORCE] cannot approve ${target}: ${(err as Error).message}`,
        lines: [
          `[FORCE] target status was ${state.status} — even --force respects the terminal FINAL_APPROVED state`,
        ],
      };
    }
    return { ok: false, error: `approve: ${(err as Error).message}` };
  }
  if (opts.force) {
    warnings.push(`[FORCE] ${target} approved from ${state.status}`);
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
    notes: opts.force
      ? "force-approved via video approve --force"
      : "approved via video approve",
  });
  return { ok: true, lines: [`Checkpoint ${target} approved.`], warnings };
}

/** Reject the current stage's checkpoint with a reason code (regenerate). */
export async function rejectCheckpoint(
  root: string,
  reasonCode: string,
): Promise<WorkflowCommandResult> {
  const state = await readProjectState(root);
  if (!state) return { ok: false, error: "" };

  const next = transition(
    machineStateOf(state),
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
  return { ok: true, lines: [`rejected: ${reasonCode}`] };
}

/** Roll back to a recorded checkpoint. `confirm` receives the §18.2
 *  preview lines and decides whether to proceed (content on disk is
 *  never touched — downstream stages re-run from it). */
export async function rollbackToCheckpoint(
  root: string,
  checkpointId: string,
  confirm: (previewLines: string[]) => Promise<boolean>,
): Promise<WorkflowCommandResult> {
  const state = await readProjectState(root);
  if (!state) return { ok: false, error: "" };

  // Resolve the checkpoint id against the project's checkpoints and run
  // records — an unknown id must be rejected, not "rolled back to".
  const checkpoints = await listCheckpoints(root);
  const target = checkpoints.find((cp) => cp.id === checkpointId);
  if (!target) {
    const ids = checkpoints.map(
      (cp) => `  ${cp.id}  (${cp.stage}, ${cp.status})`,
    );
    return {
      ok: false,
      error: `rollback: unknown checkpoint "${checkpointId}"`,
      lines:
        ids.length > 0
          ? [`available checkpoints:`, ...ids]
          : ["  (no checkpoints recorded yet)"],
    };
  }
  const targetStage = target.stage;
  const downstream = stagesInvalidatedBy(targetStage);

  if (state.status === "FINAL_APPROVED") {
    return {
      ok: false,
      error: `rollback: project is FINAL_APPROVED (terminal) — run \`video reset --force\` to rework it`,
    };
  }

  const preview = [
    `Rollback to checkpoint ${target.id}`,
    `  stage:            ${targetStage} (created ${target.created_at})`,
    `  invalidated:      ${downstream.join(", ") || "nothing downstream"}`,
    `  content on disk:  untouched (§18.2) — downstream stages re-run from it`,
  ];
  if (targetStage === "storyboard") {
    preview.push(
      `  scene edits:      use \`video scene list\` / \`video scene restore\` for per-scene content`,
    );
  }
  if (!(await confirm(preview))) {
    return { ok: true, lines: ["aborted"] };
  }

  let rolled;
  try {
    rolled = transition(
      machineStateOf(state),
      { kind: "rollback", toCheckpoint: target.id },
      ctx(`rollback-${target.id}`),
    );
  } catch (err) {
    return {
      ok: false,
      error: `rollback: ${(err as Error).message} — from ${state.status}, use \`video reset\` instead`,
    };
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
    await invalidateCheckpoint(
      root,
      stage,
      `invalidated by rollback to ${target.id}`,
    );
  }
  await writeRun(root, {
    run_id: formatRunId("rollback"),
    stage: "rollback",
    status: "succeeded",
    actor: "human",
    tool: "video-rollback",
    input_commit: safeGitHead(root),
    input_files: [`checkpoints/${targetStage}.yaml`],
    output_files: [],
    created_at: new Date().toISOString(),
    duration_ms: 0,
  });
  return {
    ok: true,
    lines: [
      `✓ rolled back to ${target.id} — state ${state.status} / ${state.current_stage}`,
      `  next: re-run the invalidated stages (e.g. \`video preview --force\` after edits, or \`video make\`), then re-approve`,
    ],
  };
}

/** Rewind the project to DRAFT and set current_stage (default init).
 *  `force` is the only way out of the terminal FINAL_APPROVED state. */
export async function resetProject(
  root: string,
  opts: { toStage?: string; force?: boolean } = {},
): Promise<WorkflowCommandResult> {
  const target = (opts.toStage ?? "init").trim();
  if (!(V01_STAGES as readonly string[]).includes(target)) {
    return { ok: false, error: `reset: unknown stage "${target}"` };
  }
  const state = await readProjectState(root);
  if (!state) {
    return { ok: false, error: "reset: no project state found; nothing to reset" };
  }

  let next: ReturnType<typeof transition>;
  try {
    next = transition(
      machineStateOf(state),
      { kind: "reset", ...(opts.force ? { force: true } : {}) },
      ctx("reset-to-" + target),
    );
  } catch (err) {
    if (opts.force) {
      return { ok: false, error: `[FORCE] cannot reset: ${(err as Error).message}` };
    }
    return {
      ok: false,
      error: `reset: ${(err as Error).message}`,
      lines: [
        `reset: if the project is in FINAL_APPROVED, pass --force to rewind anyway`,
      ],
    };
  }
  const warnings = [
    opts.force
      ? `[FORCE] resetting ${state.status} → DRAFT, current_stage=${state.current_stage} → ${target}`
      : `reset: ${state.status} → DRAFT, current_stage=${state.current_stage} → ${target}`,
  ];

  state.status = next.state.status;
  state.current_stage = target as (typeof V01_STAGES)[number];
  state.checkpoint = { id: state.checkpoint.id, status: next.state.status };
  await writeProjectState(root, state);
  // The prior checkpoint at the target stage is stale after a rewind —
  // mark it invalidated instead of writing a fake "approved" record over it.
  await invalidateCheckpoint(
    root,
    target as (typeof V01_STAGES)[number],
    opts.force ? "invalidated by video reset --force" : "invalidated by video reset",
  );
  return {
    ok: true,
    warnings,
    lines: [
      `Project reset to DRAFT / ${target}.`,
      `next: re-run the pipeline (e.g. \`video storyboard ...\` or \`video audio ...\`)`,
    ],
  };
}
