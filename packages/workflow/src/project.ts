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
  const existing: CheckpointRecord | null = await readFile(file, "utf8")
    .then((t) => parseYaml(t) as CheckpointRecord)
    .catch((err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    });
  const merged: CheckpointRecord = existing
    ? {
        ...existing,
        ...record,
        human_changes: [...existing.human_changes, ...record.human_changes],
      }
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

/** Load every stage checkpoint that exists (id/stage/created_at/status). */
export async function listCheckpoints(
  projectRoot: string,
): Promise<CheckpointRecord[]> {
  const { readdir } = await import("node:fs/promises");
  const dir = path.join(projectRoot, "checkpoints");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: CheckpointRecord[] = [];
  for (const f of files) {
    if (!f.endsWith(".yaml")) continue;
    try {
      const cp = parseYaml(
        await readFile(path.join(dir, f), "utf8"),
      ) as CheckpointRecord;
      if (cp && typeof cp.id === "string") out.push(cp);
    } catch {
      // unreadable checkpoint — skip rather than break listings
    }
  }
  return out;
}

/** Mark a stage's checkpoint `invalidated` (§18.2) without destroying its
 * history: id/created_at/approval metadata stay, status and notes change.
 * No-op (true) when already invalidated; false when no checkpoint exists. */
export async function invalidateCheckpoint(
  projectRoot: string,
  stage: Stage,
  note: string,
): Promise<boolean> {
  const cp = await loadCheckpoint(projectRoot, stage);
  if (!cp) return false;
  if (cp.status === "invalidated") return true;
  cp.status = "invalidated";
  cp.notes = cp.notes ? `${cp.notes}; ${note}` : note;
  await appendCheckpoint(projectRoot, cp);
  return true;
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
