import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** Run record fields per doc §62.2 (lines 2231-2245).
 * Provider/model/token fields are present when the run involved an external
 * model call (v0.2+); v0.1 records without these remain valid.
 * `stage` is a free-form label — the workflow state machine uses `Stage`
 * separately; run records may carry any string (e.g. "research" for an
 * upstream agent run that's not part of the workflow sequence). */
export interface RunRecord {
  run_id: string;
  stage: string;
  status: "succeeded" | "failed" | "in_progress";
  actor: "human" | "agent" | "tool";
  tool: string;
  tool_version?: string | undefined;
  input_commit: string;
  input_files: string[];
  output_files: string[];
  created_at: string;
  duration_ms?: number | undefined;
  error?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  prompt_hash?: string | undefined;
  tokens?: { input: number; output: number } | undefined;
  estimated_cost_usd?: number | undefined;
}

export function formatRunId(stage: string, now = new Date()): string {
  const seq = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${stage}-${now.toISOString().replace(/\.\d+Z$/, "Z")}-${seq}`;
}

export async function writeRun(
  projectRoot: string,
  record: RunRecord,
): Promise<string> {
  const dir = path.join(projectRoot, "runs");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${record.run_id}.yaml`);
  await writeFile(file, stringifyYaml(record), "utf8");
  return file;
}

export async function listRuns(projectRoot: string): Promise<RunRecord[]> {
  const { readdir } = await import("node:fs/promises");
  const dir = path.join(projectRoot, "runs");
  try {
    const entries = await readdir(dir);
    const records: RunRecord[] = [];
    for (const e of entries) {
      if (!e.endsWith(".yaml")) continue;
      const text = await readFile(path.join(dir, e), "utf8");
      records.push(parseYaml(text) as RunRecord);
    }
    return records.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Retry policy per §62.1: validation failures are NEVER retried
 * (line 2221); transient (process/network) up to 3 attempts with backoff. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { isRetriable?: (err: unknown) => boolean; sleeps?: number[] } = {},
): Promise<T> {
  const sleeps = opts.sleeps ?? [1000, 2000, 4000];
  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= sleeps.length) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retriable = opts.isRetriable ?? (() => true);
      if (!retriable(err)) throw err;
      if (attempt === sleeps.length) break;
      const ms = sleeps[attempt];
      if (ms === undefined) break;
      await new Promise((r) => setTimeout(r, ms));
      attempt += 1;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Resume: re-runs from the last successful run's stage; never restarts
 * a project from scratch. (§62.1 line 2224). Returns the free-form stage
 * label (any string) — callers decide whether the value is a known
 * workflow stage. */
export async function lastSuccessfulStage(
  projectRoot: string,
): Promise<string | null> {
  const records = await listRuns(projectRoot);
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r?.status === "succeeded") return r.stage;
  }
  return null;
}
