import path from "node:path";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolveProjectRoot, slugifyForProject } from "./project-path.js";
import {
  appendCheckpoint,
  loadCheckpoint,
  readProjectState,
  transition,
  V01_STAGES,
  writeProjectState,
  type MachineState,
} from "@vf/workflow";

export async function runApprove(
  projectName: string | undefined,
  stage: string | undefined,
  cwd: string | undefined,
): Promise<number> {
  let root: string;
  if (projectName) {
    const base = path.resolve(cwd ?? ".");
    root = path.join(base, "projects", slugifyForProject(projectName));
  } else {
    const resolved = resolveProjectRoot(cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return 1;
    }
    root = resolved.root;
  }
  const target = (stage ?? (await readProjectState(root))?.current_stage ?? "").trim();
  if (!target) {
    console.error("approve: could not determine stage");
    return 1;
  }
  if (!(V01_STAGES as readonly string[]).includes(target)) {
    console.error(`approve: unknown stage "${target}"`);
    return 1;
  }
  const state = await readProjectState(root);
  if (!state) return 1;
  const machineState: MachineState = {
    status: state.status,
    stage: state.current_stage,
  };
  let next: ReturnType<typeof transition>;
  if (target === "final") {
    next = transition(machineState, { kind: "final_approve" }, ctx("approve-final"));
  } else {
    next = transition(machineState, { kind: "approve" }, ctx(`approve-${target}`));
  }
  state.status = next.state.status;
  state.checkpoint = { id: state.checkpoint.id, status: next.state.status };
  await writeProjectState(root, state);
  await appendCheckpoint(root, {
    id: `${target}-${next.record.run_id}`,
    stage: target as (typeof V01_STAGES)[number],
    status: target === "final" ? "approved" : "approved",
    created_at: next.record.at,
    approved_at: next.record.at,
    human_changes: [],
    notes: "approved via vf approve",
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
    const base = path.resolve(cwd ?? ".");
    root = path.join(base, "projects", slugifyForProject(projectName));
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
    const base = path.resolve(cwd ?? ".");
    root = path.join(base, "projects", slugifyForProject(projectName));
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
  console.log(
    `This will reset working state to checkpoint ${checkpointId}.\nCurrent changes will remain in Git.\nContinue? [y/N]`,
  );
  const answer = await readLine();
  if (answer.toLowerCase() !== "y") {
    console.log("aborted");
    return 0;
  }
  const machineState: MachineState = {
    status: state.status,
    stage: state.current_stage,
  };
  const next = transition(
    machineState,
    { kind: "rollback", toCheckpoint: checkpointId },
    ctx(`rollback-${checkpointId}`),
  );
  state.status = next.state.status;
  await writeProjectState(root, state);
  console.log(`✓ rolled back to ${checkpointId}`);
  return 0;
}

export async function runResume(
  projectName: string | undefined,
  cwd: string | undefined,
): Promise<number> {
  let root: string;
  if (projectName) {
    const base = path.resolve(cwd ?? ".");
    root = path.join(base, "projects", slugifyForProject(projectName));
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
  const head = execSync(`git rev-parse HEAD`, { cwd: root, encoding: "utf8" }).trim();
  console.log(`Resume from stage ${state.current_stage} at commit ${head}.`);
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
