import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { statSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import { initState, writeProjectState, approveCheckpoint } from "@video/workflow";
import {
  articleToStoryboardYaml,
  parseArticleWithRecovery,
  splitFrontmatterParts,
} from "@video/draft";
import { resolveProjectDir } from "./project-path.js";
import { runMakeCli } from "./make-command.js";

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
    if (master >= source) {
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
  writeFileSync(path.join(verticalRoot, "article.md"), verticalArticleMd(sourceMd), "utf8");

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
