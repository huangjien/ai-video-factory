import type { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import path from "node:path";
import { resolveProjectDir } from "./project-path.js";
import { existsSync } from "node:fs";
import {
  GeminiImageProvider,
  MiniMaxH3ImageProvider,
  MiniMaxImageProvider,
  MockImageProvider,
  OpenAIImageProvider,
  type ImageProvider,
} from "@video/media-generators";
import { formatRunId } from "@video/workflow";
import {
  parseArticleWithRecovery,
  resolveImageStyle,
  stylePromptSuffix,
} from "@video/draft";

export interface ThumbnailOptions {
  project: string;
  cwd?: string | undefined;
  width?: number;
  height?: number;
  providerName?:
    | "mock"
    | "minimax"
    | "minimax-h3"
    | "openai"
    | "gemini"
    | undefined;
  /** Reference image for edit-capable providers (minimax-h3). Read from
   *  disk, Base64-encoded, and sent as the edit's reference. */
  referencePath?: string | undefined;
}

/**
 * Fold the video's visual identity into the thumbnail prompt (v0.10.3).
 *
 * The scene briefs carry two contracts the thumbnail historically did not: the
 * verbatim style preset (`stylePromptSuffix`) and, for historical topics, the
 * declared setting. The result was a video rendered as editorial illustration
 * with a cinematic-35mm photographic thumbnail — the shop window selling a
 * different product than the shop.
 *
 * This is code, not a prompt instruction, on purpose: the contract rides along
 * even when `youtube/thumbnail-prompt.txt` was written by an older agent (or
 * hand-edited), the same way `expandScenePrompt` appends the style contract
 * after the LLM-authored brief so the image model always sees it.
 */
export function applyVisualIdentity(
  prompt: string,
  article: {
    image_style?: string | undefined;
    setting?: string | undefined;
  } | null,
): string {
  if (!article) return prompt;
  const parts: string[] = [prompt];
  if (article.image_style) {
    // A typo'd preset coerces to the default the same way `video make`
    // treats it, rather than failing the thumbnail over a style name.
    parts.push(stylePromptSuffix(resolveImageStyle(article.image_style)));
  }
  if (article.setting?.trim()) {
    parts.push(
      `Setting (the whole video is set here — era, region and culture; the image must stay inside it): ${article.setting.trim()}`,
    );
  }
  return parts.join("\n");
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Generate the thumbnail image for a project into `youtube/thumbnail.{jpg,png}`.
 *
 * Split out of `runThumbnail` so `video youtube --upload` can call it
 * directly: the upload path needs a thumbnail on disk, and making the
 * operator run a second command between "package" and "publish" is a step
 * that gets forgotten. Returns the written path, or null when generation
 * failed (the caller decides whether that is fatal — an upload without a
 * thumbnail still succeeds, it just looks unfinished in Studio).
 */
export async function generateThumbnailImage(opts: {
  projectRoot: string;
  providerName?:
    | "mock"
    | "minimax"
    | "minimax-h3"
    | "openai"
    | "gemini"
    | undefined;
  width?: number | undefined;
  height?: number | undefined;
  /** Project label for log lines. */
  projectLabel: string;
  /** Reference image for edit-capable providers (minimax-h3): the edit
   *  re-renders the subject from this image instead of from text alone. */
  referencePath?: string | undefined;
}): Promise<string | null> {
  const projectRoot = opts.projectRoot;
  // The run record's duration is the WORK, not the wrapper: a
  // `duration_ms: 0` in a run record reads as "instant" and hides the
  // slow call that actually happened.
  const startedAt = Date.now();
  const promptPath = path.join(projectRoot, "youtube", "thumbnail-prompt.txt");
  if (!existsSync(promptPath)) {
    console.error(`missing thumbnail prompt: ${promptPath}`);
    return null;
  }
  const { readFile } = await import("node:fs/promises");
  const basePrompt = (await readFile(promptPath, "utf8")).trim();
  if (!basePrompt) {
    console.error(`empty thumbnail prompt: ${promptPath}`);
    return null;
  }
  // v0.10.3: match the thumbnail to the video's content style. article.md is
  // the human-editable source of truth for both keys; absent (or unparseable)
  // means no identity declared, and the prompt is used as-is.
  let identity: {
    image_style?: string | undefined;
    setting?: string | undefined;
  } | null = null;
  const articlePath = path.join(projectRoot, "article.md");
  if (existsSync(articlePath)) {
    try {
      identity = parseArticleWithRecovery(await readFile(articlePath, "utf8"))
        .article.frontmatter;
    } catch {
      identity = null;
    }
  }
  const prompt = applyVisualIdentity(basePrompt, identity);
  if (prompt !== basePrompt) {
    console.log(
      `thumbnail: applied video visual identity (style/setting from article.md)`,
    );
  }

  // YouTube recommended thumbnail: 1280x720 (16:9)
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;

  // `minimax` (image-01) / `openai` / `gemini` call the hosted image APIs
  // (each needs its own API key); `mock` (default) keeps the offline
  // deterministic path.
  let provider: ImageProvider;
  let referenceImages: { base64: string; contentType: string }[] = [];
  if (opts.providerName === "minimax") {
    provider = new MiniMaxImageProvider();
  } else if (opts.providerName === "minimax-h3") {
    if (opts.referencePath !== undefined) {
      // The H3 edit endpoint takes reference images as data URIs; the
      // format in the URI must be lowercase (the API's documented shape).
      const { readFile } = await import("node:fs/promises");
      referenceImages = [
        {
          base64: (await readFile(opts.referencePath)).toString("base64"),
          contentType: opts.referencePath.toLowerCase().endsWith(".png")
            ? "image/png"
            : "image/jpeg",
        },
      ];
      console.log(
        `  reference: ${path.basename(opts.referencePath)} (H3 edit mode)`,
      );
    }
    provider = new MiniMaxH3ImageProvider();
  } else if (opts.providerName === "openai") {
    provider = new OpenAIImageProvider();
  } else if (opts.providerName === "gemini") {
    provider = new GeminiImageProvider();
  } else {
    provider = new MockImageProvider({ width, height });
  }
  let result;
  try {
    result = await provider.generate({
      prompt,
      width,
      height,
      ...(referenceImages.length > 0 ? { referenceImages } : {}),
    });
  } catch (err) {
    console.error(
      `\u2717 ${provider.name} thumbnail generation failed:`,
      (err as Error).message,
    );
    return null;
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
    duration_ms: Date.now() - startedAt,
    provider: provider.name,
    model: `${width}x${height}`,
    prompt_hash: promptHash,
    tokens: { input: 0, output: 0 },
    estimated_cost_usd: 0,
  };
  const { writeRun } = await import("@video/workflow");
  await writeRun(projectRoot, record);

  console.log(
    `\u2713 generated ${opts.projectLabel}/youtube/${path.basename(thumbPath)}`,
  );
  console.log(
    `  provider=${provider.name}  size=${width}x${height}  prompt_hash=${promptHash.slice(0, 16)}…`,
  );
  brandProjectThumbnail(projectRoot);
  // Branding expands the canvas into thumbnail.jpg — prefer it over a raw
  // png so YouTube/Bilibili uploads always carry the brand mark.
  const branded = path.join(projectRoot, "youtube", "thumbnail.jpg");
  return existsSync(branded) ? branded : thumbPath;
}

/**
 * `video thumbnail <project>` — generate the thumbnail image on its own.
 *
 * Kept as a standalone verb for re-generating a thumbnail after an edit
 * (the image is content-independent, so a re-run always overwrites), but the
 * upload path no longer requires it: `video youtube --upload` calls
 * `generateThumbnailImage` itself when no thumbnail exists yet.
 */
export async function runThumbnail(opts: ThumbnailOptions): Promise<number> {
  // The run record's duration is the WORK, not the wrapper: a
  // `duration_ms: 0` in a run record reads as "instant" and
  // hides the slow call that actually happened.
  const startedAt = Date.now();
  const resolvedProject = resolveProjectDir(opts.project, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    return 1;
  }
  const thumbPath = await generateThumbnailImage({
    projectRoot: resolvedProject.root,
    projectLabel: opts.project,
    ...(opts.providerName !== undefined
      ? { providerName: opts.providerName }
      : {}),
    ...(opts.width !== undefined ? { width: opts.width } : {}),
    ...(opts.height !== undefined ? { height: opts.height } : {}),
  });
  if (thumbPath === null) return 1;
  console.log(`  next: upload ${path.basename(thumbPath)} to YouTube Studio`);
  return 0;
}

/** Brand the generated thumbnail (scripts/thumbnail-brand.py): expanded
 *  朱红 canvas + top-left mascot badge — the channel mark on every
 *  thumbnail (owner mandate 2026-11-19). Best-effort: an unbranded
 *  thumbnail still uploads when Pillow or the script is missing. */
export function brandProjectThumbnail(projectRoot: string): void {
  const ytDir = path.join(projectRoot, "youtube");
  if (!existsSync(ytDir)) return;
  let script = path.join(projectRoot, "..", "..", "scripts", "thumbnail-brand.py");
  if (!existsSync(script)) {
    // l10n workdirs sit deeper — walk up until the repo scripts dir turns up
    let dir = projectRoot;
    for (let i = 0; i < 4 && !existsSync(script); i++) {
      dir = path.dirname(dir);
      script = path.join(dir, "scripts", "thumbnail-brand.py");
    }
  }
  if (!existsSync(script)) return;
  try {
    execFileSync("python3", [script, ytDir], { stdio: "inherit" });
  } catch (err) {
    console.error(`  ! thumbnail branding skipped: ${(err as Error).message}`);
  }
}

export function registerThumbnail(program: Command): void {
  program
    .command("thumbnail")
    .argument(
      "<project>",
      "project for the thumbnail: topic, folder name, path, or unique prefix",
    )
    .option("--cwd <dir>", "base directory for the project")
    .option("--width <px>", "thumbnail width (default 1280)", (v) =>
      parseInt(v, 10),
    )
    .option("--height <px>", "thumbnail height (default 720)", (v) =>
      parseInt(v, 10),
    )
    .option(
      "--provider <name>",
      "image provider: mock|minimax|minimax-h3|openai|gemini (default mock — minimax-h3 is MiniMax-H3-Image: generation + reference-image edit, needs MINIMAX_API_KEY)",
    )
    .option(
      "--reference <path>",
      "reference image for minimax-h3 edit mode: the thumbnail re-renders this image's subject (jpg/png)",
    )
    .action(
      async (
        project: string,
        opts: {
          cwd?: string;
          width?: number;
          height?: number;
          provider?: "mock" | "minimax" | "minimax-h3" | "openai" | "gemini";
          reference?: string;
        },
      ) => {
        process.exitCode = await runThumbnail({
          project,
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.width !== undefined ? { width: opts.width } : {}),
          ...(opts.height !== undefined ? { height: opts.height } : {}),
          ...(opts.provider !== undefined
            ? { providerName: opts.provider }
            : {}),
          ...(opts.reference !== undefined
            ? { referencePath: opts.reference }
            : {}),
        });
      },
    );
}
