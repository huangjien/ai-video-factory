import type { Stage } from "./states.js";

/** Dependency invalidation map (v0.1 — §18.2 adapted):
 * `storyboard` invalidates everything downstream; downstream stages only
 * depend on the immediately preceding stage. Rollback marks downstream
 * checkpoints as `invalidated` (§18.2 lines 799-801) without deleting files.
 */
export const DEPENDENCY_MAP: Record<Stage, ReadonlyArray<Stage>> = {
  init: ["storyboard", "compile", "render", "review", "final"],
  storyboard: ["compile", "render", "review", "final"],
  compile: ["render", "review", "final"],
  render: ["review", "final"],
  review: ["final"],
  final: [],
};

export function stagesInvalidatedBy(stage: Stage): ReadonlyArray<Stage> {
  return DEPENDENCY_MAP[stage];
}

export interface CheckpointRecord {
  id: string;
  stage: Stage;
  status: "approved" | "rejected" | "invalidated" | "in_progress";
  created_at: string;
  approved_at?: string | undefined;
  input_commit?: string | undefined;
  output_commit?: string | undefined;
  human_changes: string[];
  notes: string;
}

export function newCheckpoint(args: {
  stage: Stage;
  id: string;
  notes?: string;
}): CheckpointRecord {
  return {
    id: args.id,
    stage: args.stage,
    status: "in_progress",
    created_at: new Date().toISOString(),
    human_changes: [],
    notes: args.notes ?? "",
  };
}
