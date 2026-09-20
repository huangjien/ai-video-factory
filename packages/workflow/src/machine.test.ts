import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendCheckpoint,
  initState,
  loadCheckpoint,
  STATES,
  stagesInvalidatedBy,
  transition,
  type MachineState,
  writeProjectState,
} from "./index.js";

describe("transition (todo 11) — §18.1", () => {
  it("DRAFT → GENERATING → VALIDATING → WAITING_REVIEW chain succeeds", () => {
    const init: MachineState = { status: "DRAFT", stage: "init" };
    let cur: MachineState = init;
    cur = transition(cur, { kind: "start" }, makeCtx()).state;
    expect(cur.status).toBe("GENERATING");
    cur = transition(cur, { kind: "validate_ok" }, makeCtx()).state;
    expect(cur.status).toBe("VALIDATING");
    cur = transition(cur, { kind: "validate_ok" }, makeCtx()).state;
    expect(cur.status).toBe("WAITING_REVIEW");
  });

  it("WAITING_REVIEW → APPROVED → DRAFT (next stage)", () => {
    const cur: MachineState = {
      status: "WAITING_REVIEW",
      stage: "storyboard",
    };
    const approved = transition(cur, { kind: "approve" }, makeCtx()).state;
    expect(approved.status).toBe("APPROVED");
  });

  it("VALIDATING → FAILED → GENERATING retry chain", () => {
    const cur: MachineState = { status: "VALIDATING", stage: "compile" };
    const failed = transition(cur, { kind: "validate_fail" }, makeCtx()).state;
    expect(failed.status).toBe("FAILED");
    const retry = transition(failed, { kind: "retry" }, makeCtx()).state;
    expect(retry.status).toBe("GENERATING");
  });

  it("VALIDATING → BLOCKED (non-retriable)", () => {
    const cur: MachineState = { status: "VALIDATING", stage: "compile" };
    const blocked = transition(
      cur,
      { kind: "block", reason: "missing asset" },
      makeCtx(),
    ).state;
    expect(blocked.status).toBe("BLOCKED");
  });

  it("rejects illegal transitions", () => {
    const cur: MachineState = { status: "DRAFT", stage: "init" };
    expect(() => transition(cur, { kind: "approve" }, makeCtx())).toThrow(
      /illegal transition/,
    );
    const reviewing: MachineState = {
      status: "WAITING_REVIEW",
      stage: "storyboard",
    };
    expect(() =>
      transition(reviewing, { kind: "final_approve" }, makeCtx()),
    ).toThrow(/illegal/);
  });

  it("every transition returns a TransitionRecord with run_id, actor, timestamps", () => {
    const cur: MachineState = { status: "DRAFT", stage: "init" };
    const { record } = transition(cur, { kind: "start" }, makeCtx("run-1"));
    expect(record.run_id).toBe("run-1");
    expect(record.actor).toBe("agent");
    expect(record.from).toBe("DRAFT");
    expect(record.to).toBe("GENERATING");
    expect(record.at).toMatch(/T/);
  });
});

describe("invalidation (todo 11) — §18.2", () => {
  it("storyboard invalidates compile + render + review + final", () => {
    expect(stagesInvalidatedBy("storyboard")).toEqual([
      "compile",
      "render",
      "review",
      "final",
    ]);
  });

  it("compile invalidates render + review + final", () => {
    expect(stagesInvalidatedBy("compile")).toEqual([
      "render",
      "review",
      "final",
    ]);
  });

  it("final invalidates nothing", () => {
    expect(stagesInvalidatedBy("final")).toEqual([]);
  });
});

describe("project state + checkpoints (todo 11)", () => {
  it("readProjectState returns null when no state.yaml exists", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vf-wf-"));
    expect(await loadCheckpoint(dir, "storyboard")).toBeNull();
  });

  it("writeProjectState round-trips and appendCheckpoint merges records", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vf-wf-"));
    const state = initState("demo");
    await writeProjectState(dir, state);
    const reloaded = await loadCheckpoint(dir, "init").catch(() => null);
    expect(reloaded).toBeNull();
    const cp = {
      id: "storyboard-v1",
      stage: "storyboard" as const,
      status: "approved" as const,
      created_at: new Date().toISOString(),
      human_changes: ["tighten intro"],
      notes: "ok",
    };
    await appendCheckpoint(dir, cp);
    const loaded = await loadCheckpoint(dir, "storyboard");
    expect(loaded?.id).toBe("storyboard-v1");
  });

  it("exports all 10 states from §18.1", () => {
    expect(STATES).toHaveLength(10);
    expect(new Set(STATES)).toEqual(
      new Set([
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
      ]),
    );
  });
});

function makeCtx(run_id = "run-test") {
  return { run_id, actor: "agent" as const };
}
