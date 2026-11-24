import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { Command } from "commander";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import { initState, writeProjectState, approveCheckpoint } from "@video/workflow";
import {
  callDraft,
  articleToStoryboardYaml,
  parseArticleWithRecovery,
  splitFrontmatterParts,
} from "@video/draft";
import { resolveProjectDir } from "./project-path.js";
import { providerInstance } from "./draft-command.js";
import { loadProviderConfig } from "@video/llm";
import { probeDurationSec, selectShortsWindow } from "./shorts-command.js";
import { readSceneTimings } from "@video/media";
import { runMakeCli } from "./make-command.js";

const execFileAsync = promisify(execFile);

/** YouTube Shorts cap for a vertical master. */
const SHORTS_CAP_SEC = 180;

/**
 * Trim a rendered master to `seconds` (re-encode, so the cut lands on a
 * clean frame with intact audio). The master is replaced in place.
 */
async function trimMaster(masterPath: string, seconds: number): Promise<void> {
  const tmp = `${masterPath}.trimmed.mp4`;
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    masterPath,
    "-t",
    String(seconds),
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    tmp,
  ]);
  renameSync(tmp, masterPath);
}

/**
 * `video vertical <project>` — a NATIVE vertical master of an existing
 * film (2026-11-20).
 *
 * Why not a crop: the renderer burns the caption band and the title card
 * INTO the scene mp4s, so cropping a landscape master can only cut them
 * away — the vertical cut had the wrong image, no title and misplaced
 * subtitles. A vertical master is produced instead: the same article is
 * re-declared `format: vertical` in a sibling workdir
 * (`projects/<slug>/vertical/`, the same shape as the l10n workdir), and
 * make renders it at 1080×1920 with the vertical-aware pieces the format
 * threading already provides — image prompts that compose tall, the
 * ratio-based caption band, the vertical title card, the scaled watermark.
 *
 * The short vertical cut for YouTube Shorts is cut from THIS master
 * (a trim, not a crop — no distortion).
 */

export interface VerticalOptions {
  project: string;
  cwd?: string | undefined;
  /** Re-render even when a vertical master already exists. */
  force?: boolean;
  /** Image provider for the vertical render (default: the project's own). */
  imageProvider?: string | undefined;
}

export function verticalRootFor(projectRoot: string): string {
  return path.join(projectRoot, "vertical");
}

/** The source article with `format: vertical` declared. Everything else
 *  (script, scenes, voice) is the SAME film — only the frame changes. */
export function verticalArticleMd(sourceMd: string): string {
  const parts = splitFrontmatterParts(sourceMd);
  if (parts === null) {
    throw new Error("article.md has no frontmatter block — cannot derive a vertical master");
  }
  const fm = (parseYaml(parts.frontmatterRaw) ?? {}) as Record<string, unknown>;
  fm["format"] = "vertical";
  return `---\n${yamlStringify(fm)}---\n${parts.body}`;
}

export async function runVertical(opts: VerticalOptions): Promise<number> {
  const repoRoot = path.resolve(opts.cwd ?? ".");
  const resolved = resolveProjectDir(opts.project, opts.cwd);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const projectRoot = resolved.root;
  const articlePath = path.join(projectRoot, "article.md");
  if (!existsSync(articlePath)) {
    console.error(`missing article.md in ${projectRoot} — draft the film first`);
    return 1;
  }
  const verticalRoot = verticalRootFor(projectRoot);
  const masterPath = path.join(verticalRoot, "output", "final-mixed.mp4");

  // Idempotent: an existing master that is newer than the source article
  // means the work is done — re-rendering 16 images is not free.
  if (existsSync(masterPath) && opts.force !== true) {
    const master = statSync(masterPath).mtimeMs;
    const source = statSync(articlePath).mtimeMs;
    const seconds = await probeDurationSec(masterPath);
    if (master >= source && seconds > 0 && seconds <= 180) {
      console.log(`✓ vertical master already built: ${masterPath}`);
      console.log(`  (article.md unchanged since — pass --force to re-render)`);
      return 0;
    }
  }

  console.log(`▷ vertical master: ${verticalRoot}`);
  for (const dir of [
    "storyboard",
    path.join("assets", "audio"),
    path.join("assets", "fonts"),
    "captions",
    "checkpoints",
    "runs",
    "output",
  ]) {
    mkdirSync(path.join(verticalRoot, dir), { recursive: true });
  }

  const sourceMd = readFileSync(articlePath, "utf8");
  const source = parseArticleWithRecovery(sourceMd).article;
  let derived = verticalArticleMd(sourceMd);
  if (Math.max(source.frontmatter.duration_target_sec, source.scenes.reduce((sum, scene) => sum + (scene.duration ?? 0), 0)) > 180) {
    const { primary, fallback } = loadProviderConfig().script;
    const summary = await callDraft({
      topic: source.title ?? source.frontmatter.project,
      audience: "Viewers of the short vertical edition",
      language: source.frontmatter.language,
      duration: 150,
      fromContent: sourceMd,
      feedback: "Adapt the supplied landscape edition into a self-contained short. Keep the thesis, strongest evidence, essential caveats and conclusion. Drop secondary arguments. Rewrite transitions and narration for the shorter runtime. Use only facts from the source.",
    }, providerInstance(primary), fallback ? providerInstance(fallback) : null);
    const body = splitFrontmatterParts(summary.markdown)!.body;
    const metadata = parseYaml(splitFrontmatterParts(derived)!.frontmatterRaw);
    metadata.duration_target_sec = 150;
    derived = `---\n${yamlStringify(metadata)}---\n${body}`;
  }
  writeFileSync(path.join(verticalRoot, "article.md"), derived, "utf8");

  // The audio plan travels with the film (same voice, BGM, SFX).
  const audioConfig = path.join(projectRoot, "audio-config.yaml");
  if (existsSync(audioConfig)) {
    writeFileSync(
      path.join(verticalRoot, "audio-config.yaml"),
      readFileSync(audioConfig, "utf8"),
      "utf8",
    );
  }

  // A state file makes the workdir a project root, so make can resolve it.
  const fm = parseYaml(
    splitFrontmatterParts(sourceMd)?.frontmatterRaw ?? "",
  ) as Record<string, unknown> | null;
  const projectId =
    typeof fm?.["project"] === "string" ? fm["project"] : path.basename(projectRoot);
  await writeProjectState(verticalRoot, initState(projectId));

  // Derive the vertical storyboard up front and approve it, so make's
  // render-preview passes its gate on the FIRST pass (the landscape flow
  // gets this for free because the draft step leaves an approved
  // storyboard behind; the vertical workdir is derived, not drafted).
  const verticalMd = readFileSync(path.join(verticalRoot, "article.md"), "utf8");
  const verticalStoryboard = articleToStoryboardYaml(
    parseArticleWithRecovery(verticalMd).article,
  );
  writeFileSync(
    path.join(verticalRoot, "storyboard", "storyboard.yaml"),
    verticalStoryboard,
    "utf8",
  );
  const approved = await approveCheckpoint(verticalRoot, { stage: "storyboard" });
  if (!approved.ok) {
    console.error(`✗ could not approve the vertical storyboard: ${approved.error}`);
    return 1;
  }

  const code = await runMakeCli({
    project: verticalRoot,
    cwd: repoRoot,
    ...(opts.imageProvider !== undefined
      ? { imageProvider: opts.imageProvider as "minimax" | "openai" | "gemini" | "mock" | "none" }
      : {}),
  });
  if (code !== 0) {
    console.error(`✗ vertical make failed (exit ${code}) — rerun \`video vertical ${opts.project}\``);
    return code;
  }
  const duration = await probeDurationSec(masterPath);
  if (duration <= 0) {
    console.error(`Vertical master failed duration check (${duration}s, maximum ${SHORTS_CAP_SEC}s).`);
    return 1;
  }
  if (duration > SHORTS_CAP_SEC) {
    // The narration can run longer than the scripted scene durations (the
    // Edge voice reads slower than planned), so a master lands a few
    // seconds over the cap. Trim to the last scene boundary that fits
    // instead of failing the whole render — measured 2026-11-23: a
    // 150 s script produced a 183.8 s master and the stage failed.
    const timings = await readSceneTimings(verticalRoot).catch(() => []);
    const window = selectShortsWindow(timings, duration, SHORTS_CAP_SEC);
    const boundary = Math.floor(window.end);
    // Cut on a scene edge when the render tracks the script. When the TTS
    // outran the scripted durations (183.8 s rendered from a 150 s script),
    // the boundaries are stale and cutting on one would drop a whole
    // scene — trim the tail instead.
    const cut =
      boundary > 0 && duration - boundary <= 15
        ? Math.min(boundary, SHORTS_CAP_SEC - 1)
        : SHORTS_CAP_SEC - 1;
    if (cut <= 0) {
      console.error(`Vertical master failed duration check (${duration}s, maximum ${SHORTS_CAP_SEC}s).`);
      return 1;
    }
    try {
      await trimMaster(masterPath, cut);
    } catch (err) {
      console.error(`✗ could not trim the vertical master: ${(err as Error).message}`);
      return 1;
    }
    const trimmed = await probeDurationSec(masterPath);
    if (trimmed <= 0 || trimmed > SHORTS_CAP_SEC) {
      console.error(
        `Vertical master failed duration check after trim (${trimmed}s, maximum ${SHORTS_CAP_SEC}s).`,
      );
      return 1;
    }
    console.log(`  ! vertical master trimmed ${duration}s → ${trimmed}s (${SHORTS_CAP_SEC}s Shorts cap)`);
  }
  console.log(`✓ vertical master: ${masterPath}`);
  return 0;
}

export function registerVertical(program: Command): void {
  program
    .command("vertical")
    .argument(
      "<project>",
      "project to re-render vertically: topic, folder name, path, or unique prefix",
    )
    .description(
      "native 1080x1920 vertical master of an existing film (re-renders scenes with vertical composition, correct captions/title/watermark)",
    )
    .option("--cwd <dir>", "repo root (default: current directory)")
    .option("--force", "re-render even when a vertical master already exists")
    .option(
      "--image-provider <provider>",
      "image provider for the vertical render (default: the project's own)",
    )
    .action(
      async (
        project: string,
        opts: { cwd?: string; force?: boolean; imageProvider?: string },
      ) => {
        process.exitCode = await runVertical({
          project,
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.force === true ? { force: true } : {}),
          ...(opts.imageProvider !== undefined
            ? { imageProvider: opts.imageProvider }
            : {}),
        });
      },
    );
}
