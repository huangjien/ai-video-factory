import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  approveCheckpoint,
  appendCheckpoint,
  initState,
  listCheckpoints,
  loadCheckpoint,
  readProjectState,
  rejectCheckpoint,
  resetProject,
  rollbackToCheckpoint,
  writeProjectState,
  type ProjectState,
} from "./index.js";

let dir: string;

async function setState(
  status: ProjectState["status"],
  stage: ProjectState["current_stage"],
): Promise<void> {
  const state = initState("cmdtest");
  state.status = status;
  state.current_stage = stage;
  await writeProjectState(dir, state);
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "vf-wf-cmds-"));
  mkdirSync(path.join(dir, "storyboard"), { recursive: true });
  writeFileSync(
    path.join(dir, "storyboard", "storyboard.yaml"),
    "schema_version: '0.2'\nscenes: []\n",
    "utf8",
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("approveCheckpoint", () => {
  it("fails on an unknown stage", async () => {
    await setState("DRAFT", "init");
    const r = await approveCheckpoint(dir, { stage: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unknown stage "nope"');
  });

  it("fails when the storyboard artifact is missing", async () => {
    const bare = mkdtempSync(path.join(tmpdir(), "vf-wf-bare-"));
    try {
      const r = await approveCheckpoint(bare, { stage: "storyboard" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("no storyboard");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("approves from WAITING_REVIEW and appends the checkpoint", async () => {
    await setState("WAITING_REVIEW", "storyboard");
    const before = (await listCheckpoints(dir)).length;
    const r = await approveCheckpoint(dir, { stage: "storyboard" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines[0]).toBe("Checkpoint storyboard approved.");
    expect((await listCheckpoints(dir)).length).toBe(before + 1);
    expect((await readProjectState(dir))?.status).not.toBe("WAITING_REVIEW");
  });
});

describe("rejectCheckpoint", () => {
  it("marks the current checkpoint rejected and records the reason", async () => {
    await setState("WAITING_REVIEW", "storyboard");
    await appendCheckpoint(dir, {
      id: "storyboard-reject-test",
      stage: "storyboard",
      status: "approved",
      created_at: new Date().toISOString(),
      human_changes: [],
      notes: "",
    });
    const r = await rejectCheckpoint(dir, "wrong-content");
    expect(r.ok).toBe(true);
    const cp = await loadCheckpoint(dir, "storyboard");
    expect(cp?.status).toBe("rejected");
    expect(cp?.human_changes).toContain("rejected: wrong-content");
  });
});

describe("rollbackToCheckpoint", () => {
  it("rejects an unknown checkpoint id and lists what exists", async () => {
    await setState("DRAFT", "storyboard");
    const r = await rollbackToCheckpoint(dir, "no-such-id", async () => true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unknown checkpoint "no-such-id"');
  });

  it("aborts cleanly when confirmation is declined", async () => {
    await setState("APPROVED", "storyboard");
    await appendCheckpoint(dir, {
      id: "rb-target",
      stage: "storyboard",
      status: "approved",
      created_at: new Date().toISOString(),
      human_changes: [],
      notes: "",
    });
    const r = await rollbackToCheckpoint(dir, "rb-target", async () => false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines).toContain("aborted");
    expect((await readProjectState(dir))?.status).toBe("APPROVED");
  });
});

describe("resetProject", () => {
  it("fails on an unknown stage", async () => {
    const r = await resetProject(dir, { toStage: "bogus" });
    expect(r.ok).toBe(false);
  });

  it("rewinds to DRAFT at the requested stage", async () => {
    await setState("APPROVED", "review");
    const r = await resetProject(dir, { toStage: "storyboard" });
    expect(r.ok).toBe(true);
    const after = await readProjectState(dir);
    expect(after?.status).toBe("DRAFT");
    expect(after?.current_stage).toBe("storyboard");
  });
});
