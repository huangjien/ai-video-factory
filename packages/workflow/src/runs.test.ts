import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  formatRunId,
  lastSuccessfulStage,
  listRuns,
  withRetry,
  writeRun,
  type RunRecord,
} from "./runs.js";

function tmpRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "vf-runs-"));
}

const baseRecord = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  run_id: formatRunId("compile"),
  stage: "compile",
  status: "succeeded",
  actor: "tool",
  tool: "tsc",
  tool_version: "5.7.0",
  input_commit: "abc123",
  input_files: ["src/index.ts"],
  output_files: ["dist/index.js"],
  created_at: new Date().toISOString(),
  duration_ms: 200,
  ...overrides,
});

describe("runs + retry + resume (todo 12) — §62.1 / §62.2", () => {
  it("formatRunId emits <stage>-<UTCISO>-<seq>", () => {
    const id = formatRunId("render");
    expect(id).toMatch(/^render-\d{4}-\d{2}-\d{2}T.+-\d{3}$/);
  });

  it("writeRun + listRuns round-trips a successful record", async () => {
    const root = tmpRoot();
    const record = baseRecord();
    await writeRun(root, record);
    const list = await listRuns(root);
    expect(list).toHaveLength(1);
    expect(list[0]?.run_id).toBe(record.run_id);
    expect(list[0]?.tool_version).toBe("5.7.0");
  });

  it("withRetry: succeeds on the third attempt after two transient failures", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
      return "ok";
    });
    const result = await withRetry(fn, { sleeps: [10, 10, 10] });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("withRetry: validation failures (non-retriable) never retry", async () => {
    const fn = vi.fn(async () => {
      throw new Error("validation failed");
    });
    await expect(
      withRetry(fn, {
        sleeps: [10, 10, 10],
        isRetriable: (err) => !String(err).includes("validation"),
      }),
    ).rejects.toThrow("validation failed");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("withRetry: 4 transient failures exhaust and throw the last error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(withRetry(fn, { sleeps: [10, 10, 10] })).rejects.toThrow(
      "boom",
    );
    expect(fn).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it("lastSuccessfulStage returns the most recent succeeded stage", async () => {
    const root = tmpRoot();
    await writeRun(root, baseRecord({ stage: "compile", status: "succeeded" }));
    await writeRun(root, baseRecord({ stage: "render", status: "failed" }));
    await writeRun(root, baseRecord({ stage: "review", status: "succeeded" }));
    expect(await lastSuccessfulStage(root)).toBe("review");
  });

  it("lastSuccessfulStage returns null when no successes exist", async () => {
    const root = tmpRoot();
    expect(await lastSuccessfulStage(root)).toBeNull();
  });

  it("omits provider/model fields (v0.1 has no external model calls) — record shape honors §62.2", async () => {
    const root = tmpRoot();
    const record = baseRecord();
    await writeRun(root, record);
    expect(record).not.toHaveProperty("provider");
    expect(record).not.toHaveProperty("model");
  });
});
