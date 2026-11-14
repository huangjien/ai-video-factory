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
  /** Wire-level detail for a run that made model calls.
   *
   *  `headers_timeout_retries` is the field that earns its keep: it
   *  counts requests the CLIENT threw away (the server took longer than
   *  undici's default 300 s to send headers) and had to re-issue. A
   *  run with that number above zero paid twice for one answer. */
  telemetry?: {
    requests: number;
    streams: number;
    headers_timeout_retries: number;
    /** Output tokens the model spent THINKING rather than answering.
     *  On a reasoning model this is usually the majority of the output —
     *  the article judge's 91%. */
    reasoning_tokens: number;
  } | undefined;
}

/** Monotonic suffix for run ids written in the same second.
 *
 *  The suffix used to be random, so two runs written inside the same
 *  second had no order between them — `listRuns` sorted by
 *  `created_at` alone, and `lastSuccessfulStage` (the resume path)
 *  could then return the WRONG stage. A counter keeps the write
 *  order. */
let runSeq = 0;

export function formatRunId(stage: string, now = new Date()): string {
  runSeq = (runSeq + 1) % 1000;
  const seq = runSeq.toString().padStart(3, "0");
  return `${stage}-${now.toISOString().replace(/\.\d+Z$/, "Z")}-${seq}`;
}

/** The order of two run ids written in the same second — the trailing
 *  counter. Falls back to the whole id when it has no counter. */
function seqOf(runId: string): number {
  const m = /-(\d{3})$/.exec(runId);
  return m === null ? -1 : Number(m[1]);
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
    return records.sort((a, b) => {
      const byTime = a.created_at.localeCompare(b.created_at);
      // Same millisecond: the write order is the run id's counter.
      if (byTime !== 0) return byTime;
      const bySeq = seqOf(a.run_id) - seqOf(b.run_id);
      return bySeq !== 0 ? bySeq : a.run_id.localeCompare(b.run_id);
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
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
