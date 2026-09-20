import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { newCheckpoint, type CheckpointRecord } from "./invalidation.js";
import type { Stage, WorkflowStatus } from "./states.js";

export interface ProjectState {
  status: WorkflowStatus;
  current_stage: Stage;
  checkpoint: { id: string; status: WorkflowStatus };
  history_tail: string[];
}

export const STATE_FILENAME = "state.yaml";

export async function readProjectState(
  projectRoot: string,
): Promise<ProjectState | null> {
  try {
    const text = await readFile(path.join(projectRoot, STATE_FILENAME), "utf8");
    return parseYaml(text) as ProjectState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeProjectState(
  projectRoot: string,
  state: ProjectState,
): Promise<void> {
  await writeFile(
    path.join(projectRoot, STATE_FILENAME),
    stringifyYaml(state),
    "utf8",
  );
}

export async function appendCheckpoint(
  projectRoot: string,
  record: CheckpointRecord,
): Promise<string> {
  const dir = path.join(projectRoot, "checkpoints");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${record.stage}.yaml`);
  const existing: CheckpointRecord = await readFile(file, "utf8")
    .then((t) => parseYaml(t) as CheckpointRecord)
    .catch((err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    });
  const merged: CheckpointRecord = existing
    ? { ...existing, ...record, human_changes: [...existing.human_changes, ...record.human_changes] }
    : record;
  await writeFile(file, stringifyYaml(merged), "utf8");
  return file;
}

export async function loadCheckpoint(
  projectRoot: string,
  stage: Stage,
): Promise<CheckpointRecord | null> {
  try {
    const text = await readFile(
      path.join(projectRoot, "checkpoints", `${stage}.yaml`),
      "utf8",
    );
    return parseYaml(text) as CheckpointRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function initState(projectId: string): ProjectState {
  const cp = newCheckpoint({ stage: "init", id: `${projectId}-init-v1` });
  return {
    status: "DRAFT",
    current_stage: "init",
    checkpoint: { id: cp.id, status: "DRAFT" },
    history_tail: [],
  };
}
