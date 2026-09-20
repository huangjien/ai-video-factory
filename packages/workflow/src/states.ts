export const STATES = [
  "DRAFT",
  "GENERATING",
  "VALIDATING",
  "WAITING_REVIEW",
  "EDITING",
  "APPROVED",
  "FINAL_APPROVED",
  "FAILED",
  "BLOCKED",
  "ROLLED_BACK",
] as const;

export type WorkflowStatus = (typeof STATES)[number];

export const V01_STAGES = [
  "init",
  "storyboard",
  "compile",
  "render",
  "review",
  "final",
] as const;

export type Stage = (typeof V01_STAGES)[number];

export interface TransitionRecord {
  run_id: string;
  actor: "human" | "agent" | "tool";
  at: string;
  from: WorkflowStatus;
  to: WorkflowStatus;
  stage: Stage;
  reason: string;
  input_commit?: string | undefined;
  output_commit?: string | undefined;
}
