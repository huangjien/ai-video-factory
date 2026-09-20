import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { formatRunId } from "@vf/workflow";
import {
  MiniMaxVideoProvider,
  MockVideoProvider,
  type VideoProvider,
  type VideoResult,
} from "@vf/media-generators";

const execFileAsync = promisify(execFile);

export interface ShortsOptions {
  project: string;
  cwd?: string | undefined;
  durationSec?: number;
  startSec?: number;
  providerName?: "mock" | "minimax" | undefined;
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Resolve the thumbnail image bytes for the minimax video path.
 * v0.3 phase 1 may write either thumbnail.png (mock) or thumbnail.jpg (real). */
function readThumbnail(projectRoot: string): { bytes: Uint8Array; contentType: "image/png" | "image/jpeg" } | null {
  for (const name of ["thumbnail.jpg", "thumbnail.png"]) {
    const p = path.join(projectRoot, "youtube", name);
    if (existsSync(p)) {
      return {
        bytes: new Uint8Array(readFileSync(p)),
        contentType: name === "thumbnail.jpg" ? "image/jpeg" : "image/png",
      };
    }
  }
  return null;
}

async function shortsFfmpeg(src: string, out: string, start: number, duration: number): Promise<void> {
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
    out,
  ]);
}

export async function runShorts(opts: ShortsOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const projectRoot = path.join(cwd, "projects", opts.project);
  if (!existsSync(projectRoot)) {
    console.error(`project not found: ${projectRoot}`);
    return 1;
  }
  const shortsPath = path.join(projectRoot, "youtube", "shorts.mp4");

  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(projectRoot, "youtube"), { recursive: true });

  // Provider selection: mock (default, mechanical ffmpeg) or minimax (real AI
  // video from thumbnail + shorts-hook). The minimax path requires:
  //   - MINIMAX_API_KEY env var
  //   - youtube/thumbnail.{png|jpg} produced by `vf thumbnail`
  //   - youtube/shorts-hook.txt produced by `vf youtube`
  const provider: VideoProvider =
    opts.providerName === "minimax" ? new MiniMaxVideoProvider() : new MockVideoProvider();

  let result: VideoResult;
  let runRecord: {
    provider: string;
    model: string;
    input_files: string[];
    prompt_hash: string;
  };

  if (provider.name === "minimax-video") {
    const thumb = readThumbnail(projectRoot);
    if (!thumb) {
      console.error(
        `\u2717 missing thumbnail for minimax provider: youtube/thumbnail.{png,jpg}`,
      );
      console.error(`  run \`vf thumbnail <project>\` first`);
      return 1;
    }
    const hookPath = path.join(projectRoot, "youtube", "shorts-hook.txt");
    if (!existsSync(hookPath)) {
      console.error(`\u2717 missing shorts hook: ${hookPath}`);
      console.error(`  run \`vf youtube <project>\` first`);
      return 1;
    }
    const hookText = readFileSync(hookPath, "utf8").trim();
    const dataUrl = `data:${thumb.contentType};base64,${Buffer.from(thumb.bytes).toString("base64")}`;
    const duration = opts.durationSec ?? 5;
    console.log(`  requesting MiniMax video (model ${provider.name}, ${duration}s, polling...)`);
    try {
      result = await provider.generate({
        prompt: hookText,
        width: 1080,
        height: 1920,
        durationSec: duration,
        firstFrameImageUrl: dataUrl,
      });
    } catch (err) {
      console.error(`\u2717 ${provider.name} video generation failed:`, (err as Error).message);
      return 1;
    }
    const { writeFile } = await import("node:fs/promises");
    await writeFile(shortsPath, result.bytes);
    runRecord = {
      provider: provider.name,
      model: "MiniMax-Hailuo-2.3",
      input_files: ["youtube/thumbnail." + thumb.contentType.split("/")[1], "youtube/shorts-hook.txt"],
      prompt_hash:
        "sha256:" +
        createHash("sha256").update(hookText + "|" + dataUrl.slice(0, 64)).digest("hex"),
    };
  } else {
    // Mock path — mechanical ffmpeg clip from final.mp4.
    const src = path.join(projectRoot, "output", "final-faststart.mp4");
    if (!existsSync(src)) {
      console.error(`missing final mp4: ${src}`);
      console.error(`  run vf final first`);
      return 1;
    }
    const duration = opts.durationSec ?? 60;
    const start = opts.startSec ?? 0;
    try {
      await shortsFfmpeg(src, shortsPath, start, duration);
    } catch (err) {
      console.error(`ffmpeg failed: ${(err as Error).message}`);
      return 1;
    }
    const hash = createHash("sha256")
      .update(`${src}|${start}|${duration}`)
      .digest("hex");
    runRecord = {
      provider: "ffmpeg",
      model: `9:16 1080x1920 ${duration}s@${start}`,
      input_files: ["output/final-faststart.mp4"],
      prompt_hash: "sha256:" + hash,
    };
  }

  const runId = formatRunId("shorts");
  const record = {
    run_id: runId,
    stage: "shorts",
    status: "succeeded" as const,
    actor: "tool" as const,
    tool: runRecord.provider,
    input_commit: safeGitHead(projectRoot),
    input_files: runRecord.input_files,
    output_files: ["youtube/shorts.mp4"],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: runRecord.provider,
    model: runRecord.model,
    prompt_hash: runRecord.prompt_hash,
    tokens: { input: 0, output: 0 },
    estimated_cost_usd: 0,
  };
  const { writeRun } = await import("@vf/workflow");
  await writeRun(projectRoot, record);

  console.log(`\u2713 extracted ${opts.project}/youtube/shorts.mp4`);
  console.log(`  provider=${runRecord.provider}  hash=${runRecord.prompt_hash.slice(7, 19)}…`);
  console.log(`  next: upload shorts.mp4 as a YouTube Short`);
  return 0;
}
