import type { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { resolveProjectDir } from "./project-path.js";
import { existsSync } from "node:fs";
import {
  GeminiImageProvider,
  MiniMaxImageProvider,
  MockImageProvider,
  OpenAIImageProvider,
  type ImageProvider,
} from "@video/media-generators";
import { formatRunId } from "@video/workflow";

export interface ThumbnailOptions {
  project: string;
  cwd?: string | undefined;
  width?: number;
  height?: number;
  providerName?: "mock" | "minimax" | "openai" | "gemini" | undefined;
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
  const resolvedProject = resolveProjectDir(opts.project, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    return 1;
  }
  const projectRoot = resolvedProject.root;
  const promptPath = path.join(projectRoot, "youtube", "thumbnail-prompt.txt");
  if (!existsSync(promptPath)) {
    console.error(`missing thumbnail prompt: ${promptPath}`);
    console.error(`  run video youtube first`);
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

  // `minimax` (image-01) / `openai` / `gemini` call the hosted image APIs
  // (each needs its own API key); `mock` (default) keeps the offline
  // deterministic path.
  let provider: ImageProvider;
  if (opts.providerName === "minimax") {
    provider = new MiniMaxImageProvider();
  } else if (opts.providerName === "openai") {
    provider = new OpenAIImageProvider();
  } else if (opts.providerName === "gemini") {
    provider = new GeminiImageProvider();
  } else {
    provider = new MockImageProvider({ width, height });
  }
  let result;
  try {
    result = await provider.generate({ prompt, width, height });
  } catch (err) {
    console.error(
      `\u2717 ${provider.name} thumbnail generation failed:`,
      (err as Error).message,
    );
    return 1;
  }

  await mkdir(path.join(projectRoot, "youtube"), { recursive: true });
  const thumbPath = path.join(
    projectRoot,
    "youtube",
    result.contentType === "image/jpeg" ? "thumbnail.jpg" : "thumbnail.png",
  );
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
    output_files: [
      result.contentType === "image/jpeg"
        ? "youtube/thumbnail.jpg"
        : "youtube/thumbnail.png",
    ],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: provider.name,
    model: `${width}x${height}`,
    prompt_hash: promptHash,
    tokens: { input: 0, output: 0 },
    estimated_cost_usd: 0,
  };
  const { writeRun } = await import("@video/workflow");
  await writeRun(projectRoot, record);

  console.log(
    `\u2713 generated ${opts.project}/youtube/${path.basename(thumbPath)}`,
  );
  console.log(
    `  provider=${provider.name}  size=${width}x${height}  prompt_hash=${promptHash.slice(0, 16)}…`,
  );
  console.log(`  next: upload ${path.basename(thumbPath)} to YouTube Studio`);
  return 0;
}

export function registerThumbnail(program: Command): void {
program
  .command("thumbnail")
  .argument("<project>", "project for the thumbnail: topic, folder name, path, or unique prefix")
  .option("--cwd <dir>", "base directory for the project")
  .option("--width <px>", "thumbnail width (default 1280)", (v) =>
    parseInt(v, 10),
  )
  .option("--height <px>", "thumbnail height (default 720)", (v) =>
    parseInt(v, 10),
  )
  .option(
    "--provider <name>",
    "image provider: mock|minimax|openai|gemini (default mock — minimax needs MINIMAX_API_KEY; openai needs OPENAI_API_KEY; gemini needs GEMINI_API_KEY)",
  )
  .action(
    async (
      project: string,
      opts: {
        cwd?: string;
        width?: number;
        height?: number;
        provider?: "mock" | "minimax" | "openai" | "gemini";
      },
    ) => {
      process.exitCode = await runThumbnail({
        project,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.width !== undefined ? { width: opts.width } : {}),
        ...(opts.height !== undefined ? { height: opts.height } : {}),
        ...(opts.provider !== undefined ? { providerName: opts.provider } : {}),
      });
    },
  );
}
