import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendCheckpoint,
  writeProjectState,
} from "@video/workflow";
import { runNew } from "./new-command.js";
import { assertStageWritable } from "./stage-guard.js";

describe("assertStageWritable — human-approval guard (doc §58)", () => {
  let cwd: string;
  let projectDir: string;
  let slug: string;

  beforeEach(async () => {
    cwd = mkdtempSync(path.join(tmpdir(), "video-stage-guard-"));
    slug = path.basename(cwd).toLowerCase();
    await runNew({ projectId: slug, cwd });
    projectDir = path.join(cwd, "projects", slug);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("allows regeneration while the stage is unapproved", async () => {
    await expect(assertStageWritable(projectDir, "storyboard", false)).resolves.toBe(
      true,
    );
  });

  it("refuses when the stage checkpoint is approved", async () => {
    await appendCheckpoint(projectDir, {
      id: "storyboard-v1",
      stage: "storyboard",
      status: "approved",
      created_at: "2026-01-01T00:00:00Z",
      approved_at: "2026-01-01T00:00:00Z",
      human_changes: [],
      notes: "test",
    });
    await expect(
      assertStageWritable(projectDir, "storyboard", false),
    ).resolves.toBe(false);
  });

  it("refuses a FINAL_APPROVED project even without checkpoints", async () => {
    await writeProjectState(projectDir, {
      status: "FINAL_APPROVED",
      current_stage: "final",
      checkpoint: { id: "final-v1", status: "FINAL_APPROVED" },
      history_tail: [],
    });
    await expect(
      assertStageWritable(projectDir, "research", false),
    ).resolves.toBe(false);
  });

  it("--force bypasses both guards", async () => {
    await appendCheckpoint(projectDir, {
      id: "storyboard-v1",
      stage: "storyboard",
      status: "approved",
      created_at: "2026-01-01T00:00:00Z",
      approved_at: "2026-01-01T00:00:00Z",
      human_changes: [],
      notes: "test",
    });
    await expect(
      assertStageWritable(projectDir, "storyboard", true),
    ).resolves.toBe(true);
  });
});
