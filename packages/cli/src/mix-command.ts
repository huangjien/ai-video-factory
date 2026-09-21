import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { mixTracks } from "@vf/audio-mix";
import { formatRunId } from "@vf/workflow";

export interface MixOptions {
  project: string;
  cwd?: string | undefined;
  /** Explicit BGM file path (defaults to first .wav in assets/audio-assets/bgm/). */
  bgmPath?: string | undefined;
  bgmAttenuationDb?: number;
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Pick the BGM file: --bgm <path> wins, else first *.wav under bgm/. */
function pickBgm(projectRoot: string, explicit?: string): string {
  if (explicit) return explicit;
  const bgmDir = path.join(projectRoot, "assets", "audio-assets", "bgm");
  if (!existsSync(bgmDir)) {
    throw new Error(
      `no BGM found: pass --bgm <path> or run \`vf audio-asset --bgm <tag>\` first`,
    );
  }
  const candidates = readdirSync(bgmDir)
    .filter((f) => f.toLowerCase().endsWith(".wav"))
    .map((f) => path.join(bgmDir, f))
    .sort();
  if (candidates.length === 0) {
    throw new Error(`no .wav files in ${bgmDir}`);
  }
  return candidates[0] ?? "";
}

function pickNarrations(projectRoot: string): string[] {
  const audioDir = path.join(projectRoot, "assets", "audio");
  if (!existsSync(audioDir)) {
    throw new Error(
      `no narration audio in ${audioDir} — run \`vf audio <project>\` first`,
    );
  }
  const files = readdirSync(audioDir)
    .filter((f) => /^scene-\d+\.wav$/.test(f))
    .sort()
    .map((f) => path.join(audioDir, f));
  if (files.length === 0) {
    throw new Error(`no scene-N.wav files in ${audioDir}`);
  }
  return files;
}

export async function runMix(opts: MixOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const projectRoot = path.join(cwd, "projects", opts.project);
  if (!existsSync(projectRoot)) {
    console.error(`project not found: ${projectRoot}`);
    return 1;
  }
  let narrationPaths: string[];
  let bgmPath: string;
  try {
    narrationPaths = pickNarrations(projectRoot);
    bgmPath = pickBgm(projectRoot, opts.bgmPath);
  } catch (err) {
    console.error(`\u2717 ${(err as Error).message}`);
    return 1;
  }

  const outPath = path.join(projectRoot, "output", "final-mixed.mp4");
  await mkdir(path.dirname(outPath), { recursive: true });

  try {
    await mixTracks({
      narrationPaths,
      bgmPath,
      outPath,
      ...(opts.bgmAttenuationDb !== undefined
        ? { bgmAttenuationDb: opts.bgmAttenuationDb }
        : {}),
    });
  } catch (err) {
    console.error(`\u2717 audio mix failed:`, (err as Error).message);
    return 1;
  }

  // Run record
  const runId = formatRunId("audio-mix");
  const promptHash =
    "sha256:" +
    createHash("sha256")
      .update(`bgm=${bgmPath}|narr=${narrationPaths.join(",")}`)
      .digest("hex");
  const record = {
    run_id: runId,
    stage: "audio-mix",
    status: "succeeded" as const,
    actor: "tool" as const,
    tool: "ffmpeg-mix",
    input_commit: safeGitHead(projectRoot),
    input_files: [
      ...narrationPaths.map((p) => path.relative(projectRoot, p)),
      path.relative(projectRoot, bgmPath),
    ],
    output_files: ["output/final-mixed.mp4"],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: "ffmpeg",
    model: "amix+sidechaincompress",
    prompt_hash: promptHash,
    tokens: { input: 0, output: 0 },
    estimated_cost_usd: 0,
  };
  const { writeRun } = await import("@vf/workflow");
  await writeRun(projectRoot, record);

  console.log(`\u2713 mixed ${opts.project}/output/final-mixed.mp4`);
  console.log(
    `  narration=${narrationPaths.length} files  bgm=${path.basename(bgmPath)}`,
  );
  console.log(`  next: this is the audio you ship — replaces per-scene narration TTS as the final mix`);
  return 0;
}
