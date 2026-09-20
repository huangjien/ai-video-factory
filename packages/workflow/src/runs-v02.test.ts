import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatRunId,
  lastSuccessfulStage,
  listRuns,
  writeRun,
  type RunRecord,
} from "./runs.js";

const baseRecord = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  run_id: formatRunId("storyboard"),
  stage: "storyboard",
  status: "succeeded",
  actor: "agent",
  tool: "vf-storyboard",
  input_commit: "abc123",
  input_files: [],
  output_files: ["storyboard/storyboard.yaml"],
  created_at: new Date().toISOString(),
  ...overrides,
});

function tmpRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "vf-runs-v02-"));
}

describe("run records — v0.2 schema (todo 7) — §62.2 lines 2247-2258", () => {
  it("round-trips provider/model/prompt_hash/tokens/cost fields", async () => {
    const root = tmpRoot();
    const record = baseRecord({
      provider: "minimax",
      model: "MiniMax-M2.7",
      prompt_hash: "sha256:abc",
      tokens: { input: 200, output: 90 },
      estimated_cost_usd: 0.0002,
    });
    await writeRun(root, record);
    const list = await listRuns(root);
    expect(list[0]?.provider).toBe("minimax");
    expect(list[0]?.model).toBe("MiniMax-M2.7");
    expect(list[0]?.prompt_hash).toBe("sha256:abc");
    expect(list[0]?.tokens).toEqual({ input: 200, output: 90 });
    expect(list[0]?.estimated_cost_usd).toBe(0.0002);
  });

  it("v0.1 records (no provider fields) still round-trip — back-compat", async () => {
    const root = tmpRoot();
    const v01: RunRecord = {
      run_id: formatRunId("render"),
      stage: "render",
      status: "succeeded",
      actor: "tool",
      tool: "remotion",
      input_commit: "deadbeef",
      input_files: ["vdsl.yaml"],
      output_files: ["output/preview.mp4"],
      created_at: new Date().toISOString(),
    };
    await writeRun(root, v01);
    const list = await listRuns(root);
    expect(list[0]?.provider).toBeUndefined();
    expect(list[0]?.model).toBeUndefined();
    expect(list[0]?.tokens).toBeUndefined();
  });

  it("lastSuccessfulStage returns the last succeeded stage across mixed records", async () => {
    const root = tmpRoot();
    await writeRun(
      root,
      baseRecord({ stage: "storyboard", status: "succeeded" }),
    );
    await writeRun(
      root,
      baseRecord({ stage: "render", status: "failed" }),
    );
    expect(await lastSuccessfulStage(root)).toBe("storyboard");
  });
});
