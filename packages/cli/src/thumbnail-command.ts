import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { MockImageProvider, type ImageProvider } from "@vf/media-generators";
import { formatRunId } from "@vf/workflow";

export interface ThumbnailOptions {
  project: string;
  cwd?: string | undefined;
  width?: number;
  height?: number;
  providerName?: string;
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export async function runThumbnail(opts: ThumbnailOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const projectRoot = path.join(cwd, "projects", opts.project);
  if (!existsSync(projectRoot)) {
    console.error(`project not found: ${projectRoot}`);
    return 1;
  }
  const promptPath = path.join(projectRoot, "youtube", "thumbnail-prompt.txt");
  if (!existsSync(promptPath)) {
    console.error(`missing thumbnail prompt: ${promptPath}`);
    console.error(`  run vf youtube first`);
    return 1;
  }
  const { readFile } = await import("node:fs/promises");
  const prompt = (await readFile(promptPath, "utf8")).trim();
  if (!prompt) {
    console.error(`empty thumbnail prompt: ${promptPath}`);
    return 1;
  }

  // YouTube recommended thumbnail: 1280x720 (16:9)
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;

  // v0.2 phase 8: only the mock provider ships. Real providers (MiniMax
  // image, image-to-video) are a v0.3 hook — the ImageProvider interface is
  // the contract that holds.
  const provider: ImageProvider = new MockImageProvider({ width, height });
  const result = await provider.generate({ prompt, width, height });

  await mkdir(path.join(projectRoot, "youtube"), { recursive: true });
  const thumbPath = path.join(projectRoot, "youtube", "thumbnail.png");
  await writeFile(thumbPath, result.bytes);

  // Run record (provider: mock, no LLM tokens)
  const runId = formatRunId("thumbnail");
  const promptHash =
    "sha256:" + createHash("sha256").update(prompt).digest("hex");
  const record = {
    run_id: runId,
    stage: "thumbnail",
    status: "succeeded" as const,
    actor: "tool" as const,
    tool: provider.name,
    input_commit: safeGitHead(projectRoot),
    input_files: ["youtube/thumbnail-prompt.txt"],
    output_files: ["youtube/thumbnail.png"],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: provider.name,
    model: `${width}x${height}`,
    prompt_hash: promptHash,
    tokens: { input: 0, output: 0 },
    estimated_cost_usd: 0,
  };
  const { writeRun } = await import("@vf/workflow");
  await writeRun(projectRoot, record);

  console.log(`\u2713 generated ${opts.project}/youtube/thumbnail.png`);
  console.log(`  provider=${provider.name}  size=${width}x${height}  prompt_hash=${promptHash.slice(0, 16)}…`);
  console.log(`  next: upload thumbnail.png to YouTube Studio`);
  return 0;
}
