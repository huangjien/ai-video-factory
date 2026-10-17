import type { Command } from "commander";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import {
  generateSceneVisuals,
  readVisualsCheckpoint,
  rejectVisualsScene,
  writeVisualsCheckpoint,
  imageSceneNumbers,
  resolveImageProvider,
} from "@video/make";
import { buildContactSheet } from "@video/media-generators";
import { parseArticleWithRecovery } from "@video/draft";
import { resolveProjectDir } from "./project-path.js";

/**
 * `video visuals` (v0.8 visual-guardrails plan, G3/G4): generate scene
 * images + a Pillow contact sheet for human review; per-scene rejection
 * force-regenerates on the next run; `video approve visuals` freezes the
 * current set into checkpoints/visuals.yaml, which `video make` enforces
 * when article.md sets `require_visual_approval: true`.
 */

export interface VisualsOptions {
  project: string;
  cwd?: string;
  imageProvider?: "minimax" | "openai" | "gemini" | "mock" | "none";
  fake?: boolean;
  rejectScene?: number;
  reason?: string;
  cols?: number;
  /** Contact-sheet runner override (tests inject a fail-fast bin). */
  pythonBin?: string;
}

export async function runVisualsCli(opts: VisualsOptions): Promise<number> {
  const resolved = resolveProjectDir(opts.project, opts.cwd);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const projectRoot = resolved.root;
  const articlePath = path.join(projectRoot, "article.md");
  if (!existsSync(articlePath)) {
    console.error(`visuals: article.md not found at ${articlePath}`);
    return 1;
  }
  const article = parseArticleWithRecovery(
    readFileSync(articlePath, "utf8"),
  ).article;

  // Rejection path: mark the scene + delete its jpg/sidecar so the next
  // generate pass (this run, below) must recreate it.
  if (opts.rejectScene !== undefined) {
    if (!opts.reason || opts.reason.trim() === "") {
      console.error('visuals: --reject requires --reason "<why>"');
      return 1;
    }
    if (readVisualsCheckpoint(projectRoot) === null) {
      console.error(
        "visuals: no approved checkpoint to reject against — run `video visuals <project>` and `video approve visuals <project>` first",
      );
      return 1;
    }
    rejectVisualsScene(projectRoot, opts.rejectScene, opts.reason.trim());
    const imageDir = path.join(projectRoot, "assets", "images");
    const jpg = path.join(imageDir, `scene_${opts.rejectScene}.jpg`);
    await rm(jpg, { force: true });
    await rm(`${jpg.replace(/\.jpg$/, "")}.cache.json`, { force: true });
    console.log(
      `✓ scene_${opts.rejectScene} rejected (${opts.reason.trim()}) — regenerating below`,
    );
  }

  const provider = resolveImageProvider(
    opts.fake,
    opts.imageProvider,
    article.frontmatter.image_provider,
  );
  if (provider !== "none") {
    console.log(`▷ generate-visuals (${provider})`);
    const outputs = await generateSceneVisuals(projectRoot, article, {
      provider,
      onEvent: (e) => {
        if (e.kind === "start") console.error(`  ⏳ ${e.label}`);
      },
    });
    for (const o of outputs) console.log(`  · ${o}`);
  } else {
    console.log("▷ generate-visuals skipped (--fake / provider none)");
  }

  // Contact sheet over whatever images exist now.
  const imageDir = path.join(projectRoot, "assets", "images");
  const captions: Record<string, string> = {};
  article.scenes.forEach((scene, i) => {
    captions[`scene_${i + 1}`] = scene.caption ?? "";
  });
  const sheet = await buildContactSheet({
    imagesDir: imageDir,
    outPath: path.join(imageDir, "contact-sheet.png"),
    captions,
    ...(opts.cols !== undefined ? { cols: opts.cols } : {}),
    ...(opts.pythonBin !== undefined ? { pythonBin: opts.pythonBin } : {}),
  });
  if (sheet.ok) {
    console.log(`✓ contact sheet: ${path.relative(projectRoot, sheet.outPath)}`);
  } else {
    console.error(`! contact sheet failed: ${sheet.error}`);
  }

  const nums = imageSceneNumbers(projectRoot);
  const checkpoint = readVisualsCheckpoint(projectRoot);
  const gateOn = article.frontmatter["require_visual_approval"] === true;
  if (gateOn) {
    if (checkpoint === null) {
      console.log(
        `\nnext: review the sheet, fix with \`video visuals <project> --reject <n> --reason "…"\`, then approve:`,
      );
      console.log(`  video approve visuals ${opts.project}`);
    } else {
      console.log(
        `\nnext: \`video approve visuals ${opts.project}\` to freeze this set (make enforces it)`,
      );
    }
  } else {
    console.log(
      `\n${nums.length} scene image(s). Gate is OFF — add \`require_visual_approval: true\` to article.md frontmatter to have make enforce approval.`,
    );
  }
  return 0;
}

/** `video approve visuals` — freeze the current image set (G4). */
export async function approveVisualsCheckpointCli(
  project: string,
  cwd?: string,
): Promise<number> {
  const resolved = resolveProjectDir(project, cwd);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const projectRoot = resolved.root;
  const nums = imageSceneNumbers(projectRoot);
  if (nums.length === 0) {
    console.error(
      `approve visuals: no scene images in ${path.join(projectRoot, "assets", "images")} — run \`video visuals ${project}\` first`,
    );
    return 1;
  }
  const checkpoint = writeVisualsCheckpoint(projectRoot);
  console.log(
    `✓ approved ${Object.keys(checkpoint.scenes).length} scene image(s) → ${path.relative(projectRoot, path.join(projectRoot, "checkpoints", "visuals.yaml"))}`,
  );
  return 0;
}

export function registerVisuals(program: Command): void {
  program
    .command("visuals")
    .argument(
      "<project>",
      "project: topic, folder name, path, or unique prefix",
    )
    .option("--cwd <dir>", "base directory for the project")
    .option(
      "--image-provider <provider>",
      "image provider: minimax (default) | openai | gemini | mock | none",
    )
    .option("--fake", "skip generation (contact sheet over existing images)")
    .option(
      "--reject <scene>",
      "scene NUMBER to reject (force-regenerates this run)",
      (v) => {
        const n = parseInt(v, 10);
        if (!Number.isInteger(n) || n < 1) {
          throw new Error(`--reject must be a positive scene number, got: ${v}`);
        }
        return n;
      },
    )
    .option("--reason <text>", "why the rejected scene is rejected")
    .option("--cols <n>", "contact sheet columns (default 4)", (v) =>
      parseInt(v, 10),
    )
    .action(async (project: string, opts: {
      cwd?: string;
      imageProvider?: "minimax" | "openai" | "gemini" | "mock" | "none";
      fake?: boolean;
      reject?: number;
      reason?: string;
      cols?: number;
    }) => {
      process.exitCode = await runVisualsCli({
        project,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.imageProvider !== undefined
          ? { imageProvider: opts.imageProvider }
          : {}),
        ...(opts.fake !== undefined ? { fake: opts.fake } : {}),
        ...(opts.reject !== undefined ? { rejectScene: opts.reject } : {}),
        ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
        ...(opts.cols !== undefined ? { cols: opts.cols } : {}),
      });
    });
}
