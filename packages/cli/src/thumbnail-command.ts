import type { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { resolveProjectDir } from "./project-path.js";
import { existsSync } from "node:fs";
import {
  FluxKleinImageProvider,
  MiniMaxImageProvider,
  MockImageProvider,
  resolveLoraConfigPath,
  type ImageProvider,
} from "@video/media-generators";
import { formatRunId } from "@video/workflow";

export interface ThumbnailOptions {
  project: string;
  cwd?: string | undefined;
  width?: number;
  height?: number;
  providerName?: "mock" | "minimax" | "flux" | undefined;
  /** Absolute path to lora-config.yaml (overrides the auto-resolved file). */
  loraConfigPath?: string | undefined;
  /** Legacy: LoRA adapters as "path[:scale][,path2[:scale2]]". */
  lora?: string | undefined;
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

  // v0.3: `minimax` uses the real image API (image-01, needs
  // MINIMAX_API_KEY); `flux` runs local FLUX.2 Klein 4B (no quota);
  // `mock` (default) keeps the offline deterministic path.
  let provider: ImageProvider;
  if (opts.providerName === "minimax") {
    provider = new MiniMaxImageProvider();
  } else if (opts.providerName === "flux") {
    const repoRoot = path.dirname(path.dirname(projectRoot));
    const explicitLora = opts.lora;
    const explicitConfig = opts.loraConfigPath;
    const discoveredConfig =
      explicitLora === undefined && explicitConfig === undefined
        ? resolveLoraConfigPath({ projectRoot, repoRoot })
        : undefined;
    provider = new FluxKleinImageProvider({
      ...(explicitConfig ? { loraConfigPath: explicitConfig } : {}),
      ...(discoveredConfig ? { loraConfigPath: discoveredConfig } : {}),
      ...(explicitLora ? { lora: explicitLora } : {}),
    });
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
    "image provider: mock|minimax|flux (default mock — minimax needs MINIMAX_API_KEY; flux runs local FLUX.2 Klein 4B)",
  )
  .option(
    "--lora-config <path>",
    "absolute path to a lora-config.yaml for the flux provider (overrides <projectRoot>/lora-config.yaml and <repo>/lora-config.yaml)",
  )
  .option(
    "--lora <spec>",
    'legacy: LoRA adapters for the flux provider, "path[:scale][,path2[:scale2]]"',
  )
  .action(
    async (
      project: string,
      opts: {
        cwd?: string;
        width?: number;
        height?: number;
        provider?: "mock" | "minimax" | "flux";
        loraConfig?: string;
        lora?: string;
      },
    ) => {
      process.exitCode = await runThumbnail({
        project,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.width !== undefined ? { width: opts.width } : {}),
        ...(opts.height !== undefined ? { height: opts.height } : {}),
        ...(opts.provider !== undefined ? { providerName: opts.provider } : {}),
        ...(opts.loraConfig !== undefined
          ? { loraConfigPath: opts.loraConfig }
          : {}),
        ...(opts.lora !== undefined ? { lora: opts.lora } : {}),
      });
    },
  );
}
