import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { formatRunId } from "@vf/workflow";

const execFileAsync = promisify(execFile);

export interface ShortsOptions {
  project: string;
  cwd?: string | undefined;
  durationSec?: number;
  startSec?: number;
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export async function runShorts(opts: ShortsOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const projectRoot = path.join(cwd, "projects", opts.project);
  if (!existsSync(projectRoot)) {
    console.error(`project not found: ${projectRoot}`);
    return 1;
  }
  const src = path.join(projectRoot, "output", "final-faststart.mp4");
  if (!existsSync(src)) {
    console.error(`missing final mp4: ${src}`);
    console.error(`  run vf final first`);
    return 1;
  }
  const shortsPath = path.join(projectRoot, "youtube", "shorts.mp4");

  // YouTube Shorts spec: vertical 9:16, max 60 seconds.
  // Crop the source horizontally and scale to 1080x1920.
  const duration = opts.durationSec ?? 60;
  const start = opts.startSec ?? 0;

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss", String(start),
      "-i", src,
      "-t", String(duration),
      "-vf",
      "crop=ih*9/16:ih,scale=1080:1920",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      shortsPath,
    ]);
  } catch (err) {
    console.error(`ffmpeg failed: ${(err as Error).message}`);
    return 1;
  }

  // Run record
  const runId = formatRunId("shorts");
  const hash = createHash("sha256")
    .update(`${src}|${start}|${duration}`)
    .digest("hex");
  const record = {
    run_id: runId,
    stage: "shorts",
    status: "succeeded" as const,
    actor: "tool" as const,
    tool: "ffmpeg",
    input_commit: safeGitHead(projectRoot),
    input_files: ["output/final-faststart.mp4"],
    output_files: ["youtube/shorts.mp4"],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: "ffmpeg",
    model: `9:16 1080x1920 ${duration}s@${start}`,
    prompt_hash: "sha256:" + hash,
    tokens: { input: 0, output: 0 },
    estimated_cost_usd: 0,
  };
  const { writeRun } = await import("@vf/workflow");
  await writeRun(projectRoot, record);

  console.log(`\u2713 extracted ${opts.project}/youtube/shorts.mp4`);
  console.log(`  format=9:16 1080x1920  start=${start}s duration=${duration}s  hash=${hash.slice(0, 12)}…`);
  console.log(`  next: upload shorts.mp4 as a YouTube Short`);
  return 0;
}
