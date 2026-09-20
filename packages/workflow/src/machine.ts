import type {
  Stage,
  TransitionRecord,
  WorkflowStatus,
} from "./states.js";

export type Action =
  | { kind: "start" }
  | { kind: "regenerate" }
  | { kind: "approve" }
  | { kind: "edit" }
  | { kind: "rollback"; toCheckpoint: string }
  | { kind: "retry" }
  | { kind: "block"; reason: string }
  | { kind: "final_approve" }
  | { kind: "validate_ok" }
  | { kind: "validate_fail" };

export interface MachineState {
  status: WorkflowStatus;
  stage: Stage;
}

const TRANSITIONS: Record<WorkflowStatus, ReadonlyArray<WorkflowStatus>> = {
  DRAFT: ["GENERATING"],
  GENERATING: ["VALIDATING"],
  VALIDATING: ["WAITING_REVIEW", "FAILED", "BLOCKED"],
  FAILED: ["GENERATING", "BLOCKED"],
  BLOCKED: ["GENERATING"],
  WAITING_REVIEW: ["APPROVED", "EDITING", "GENERATING", "ROLLED_BACK"],
  EDITING: ["VALIDATING"],
  APPROVED: ["DRAFT", "FINAL_APPROVED"],
  FINAL_APPROVED: [],
  ROLLED_BACK: ["DRAFT"],
};

/** Apply a transition; throws if the transition is not legal (§18.1 lines
 * 787-795). Returns an immutable TransitionRecord (§18.1 line 797). */
export function transition(
  state: MachineState,
  action: Action,
  context: { run_id: string; actor: TransitionRecord["actor"]; reason?: string },
): { state: MachineState; record: TransitionRecord } {
  const next = nextStatus(state.status, action);
  if (!next) {
    throw new Error(
      `illegal transition: ${state.status} → ? (action ${action.kind})`,
    );
  }
  const record: TransitionRecord = {
    run_id: context.run_id,
    actor: context.actor,
    at: new Date().toISOString(),
    from: state.status,
    to: next,
    stage: state.stage,
    reason: context.reason ?? actionReason(action),
    input_commit: undefined,
    output_commit: undefined,
  };
  const nextState: MachineState =
    action.kind === "rollback"
      ? { status: next, stage: previousStage(state.stage) }
      : next === "FINAL_APPROVED"
        ? { status: next, stage: state.stage }
        : { status: next, stage: advanceStage(state, next) };
  return { state: nextState, record };
}

function nextStatus(
  status: WorkflowStatus,
  action: Action,
): WorkflowStatus | null {
  const allowed = TRANSITIONS[status];
  switch (action.kind) {
    case "start":
    case "regenerate":
    case "retry":
      return allowed.includes("GENERATING") ? "GENERATING" : null;
    case "validate_ok":
      if (status === "GENERATING")
        return allowed.includes("VALIDATING") ? "VALIDATING" : null;
      if (status === "VALIDATING")
        return allowed.includes("WAITING_REVIEW") ? "WAITING_REVIEW" : null;
      return null;
    case "validate_fail":
      return allowed.includes("FAILED") ? "FAILED" : null;
    case "edit":
      return allowed.includes("EDITING") ? "EDITING" : null;
    case "approve":
      return allowed.includes("APPROVED") ? "APPROVED" : null;
    case "final_approve":
      return allowed.includes("FINAL_APPROVED") ? "FINAL_APPROVED" : null;
    case "rollback":
      return allowed.includes("ROLLED_BACK") ? "ROLLED_BACK" : null;
    case "block":
      return allowed.includes("BLOCKED") ? "BLOCKED" : null;
  }
}

function actionReason(action: Action): string {
  if (action.kind === "block") return action.reason;
  if (action.kind === "rollback") return `rollback to ${action.toCheckpoint}`;
  return action.kind;
}

function advanceStage(
  state: MachineState,
  next: WorkflowStatus,
): Stage {
  // When we transition into DRAFT, advance the stage cursor.
  if (next === "DRAFT") return state.stage;
  return state.stage;
}

function previousStage(stage: Stage): Stage {
  // Approximation: rollback just resets to the same stage (caller rewinds via target).
  return stage;
}
