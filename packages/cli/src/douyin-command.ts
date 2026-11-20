import type { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveProjectDir } from "./project-path.js";
import { GLMProvider, loadProviderConfig, MiniMaxProvider } from "@video/llm";
import {
  callDouyin,
  cutVertical,
  renderChecklist,
  uploadDouyin,
  verticalCutIsFresh,
  type VerticalCutMode,
} from "@video/douyin";
import { parseArticleWithRecovery } from "@video/draft";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import type { ChatMessage, Provider } from "@video/llm";
import { formatRunId } from "@video/workflow";
import { MARK_OK, MARK_RUN, brandBannerLine, channelHeader } from "./ui.js";

export interface DouyinOptions {
  project: string;
  cwd?: string | undefined;
  model?: "minimax" | "glm" | undefined;
  /** Publish through the official API. Without it the command only
   *  packages, and writes the manual-upload checklist. */
  upload?: boolean | undefined;
  /** How the 16:9 master becomes 9:16. */
  cutMode?: VerticalCutMode | undefined;
  /** Use this file as the vertical video instead of cutting one. */
  video?: string | undefined;
  /** Use this file as the cover. */
  cover?: string | undefined;
  /** Skip the cut entirely — package only. */
  noCut?: boolean | undefined;
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unknown provider: ${name}`);
}

function sha256OfMessages(messages: ChatMessage[] | undefined): string {
  const text = (messages ?? [])
    .map((m) => `${m.role}:${m.content}`)
    .join("\n\n");
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Cumulative runtime from the durations the renderer actually used — the
 *  same source YouTube chapter offsets come from. */
function totalRuntime(
  storyboardYaml: string | undefined,
  fallbackSec: number | undefined,
): number | undefined {
  if (storyboardYaml !== undefined) {
    try {
      const parsed = parseYaml(storyboardYaml) as {
        scenes?: { duration?: unknown }[];
      };
      const durations = (parsed.scenes ?? [])
        .map((s) => (typeof s.duration === "number" ? s.duration : 0))
        .filter((d) => d > 0);
      const total = durations.reduce((a, b) => a + b, 0);
      if (total > 0) return total;
    } catch {
      // fall through to the declared target
    }
  }
  return fallbackSec;
}

/** The article's own H1 is a far better topic than the folder slug. */
function articleTitle(proseBody: string, fallback: string): string {
  const h1 = proseBody.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return h1 && h1.length > 0 ? h1 : fallback;
}

function extractHook(proseBody: string): string {
  const m = proseBody.match(/^>\s*\*\*Hook\*\*[^\n]*\n+>\s*(.+)$/m);
  return m?.[1]?.trim() ?? "";
}

/** The access token, when the user has one. */
function douyinAccessToken(): string | undefined {
  const raw = process.env["DOUYIN_ACCESS_TOKEN"];
  if (raw === undefined || raw.trim() === "") return undefined;
  return raw.trim();
}

export async function runDouyin(opts: DouyinOptions): Promise<number> {
  // The run record's duration is the WORK, not the wrapper.
  const startedAt = Date.now();
  const resolved = resolveProjectDir(opts.project, opts.cwd);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const projectRoot = resolved.root;

  const articlePath = path.join(projectRoot, "article.md");
  if (!existsSync(articlePath)) {
    console.error(`missing article.md in ${projectRoot}`);
    console.error(`  run \`video draft <topic>\` first`);
    return 1;
  }
  const articleMd = await readFile(articlePath, "utf8");
  const { article } = parseArticleWithRecovery(articleMd);

  const renderedPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
  const rendered = existsSync(renderedPath)
    ? await readFile(renderedPath, "utf8")
    : undefined;

  // Reuse the YouTube cover brief when one exists: same audience, same video.
  const youtubePkgPath = path.join(projectRoot, "youtube", "package.yaml");
  let youtubeCoverPrompt: string | undefined;
  if (existsSync(youtubePkgPath)) {
    try {
      const parsed = parseYaml(await readFile(youtubePkgPath, "utf8")) as {
        thumbnail_prompt?: unknown;
      };
      if (typeof parsed.thumbnail_prompt === "string") {
        youtubeCoverPrompt = parsed.thumbnail_prompt;
      }
    } catch {
      // a broken youtube package must not block douyin packaging
    }
  }

  const douyinDir = path.join(projectRoot, "douyin");
  await mkdir(douyinDir, { recursive: true });

  // The video. Douyin is a vertical platform: a landscape post arrives
  // letterboxed. The cut keeps the whole 16:9 frame (blurred backdrop,
  // centred inset) so the title cards and captions stay readable.
  const masterPath = path.join(projectRoot, "output", "final-mixed.mp4");
  const cutPath = path.join(douyinDir, "video.mp4");
  let videoPath: string;
  let cutNote = "";
  if (opts.video !== undefined) {
    videoPath = path.resolve(opts.video);
    if (!existsSync(videoPath)) {
      console.error(`no video at ${videoPath}`);
      return 1;
    }
  } else if (opts.noCut === true) {
    if (!existsSync(masterPath)) {
      console.error(`missing rendered video at ${masterPath}`);
      console.error(`  run \`video make <project>\` first`);
      return 1;
    }
    videoPath = masterPath;
    cutNote = "using the landscape master as-is (--no-cut)";
  } else {
    if (!existsSync(masterPath)) {
      console.error(`missing rendered video at ${masterPath}`);
      console.error(`  run \`video make <project>\` first`);
      return 1;
    }
    if (!verticalCutIsFresh(cutPath, masterPath)) {
      console.log(`${MARK_RUN} cutting 16:9 → 9:16 (${opts.cutMode ?? "inset"})…`);
      try {
        await cutVertical({
          source: masterPath,
          out: cutPath,
          ...(opts.cutMode !== undefined ? { mode: opts.cutMode } : {}),
        });
      } catch (err) {
        console.error(`✗ ${(err as Error).message}`);
        return 1;
      }
    }
    videoPath = cutPath;
  }

  // The cover. The vertical thumbnail is the branded 1080×1920 one the
  // thumbnail command makes; without it the packaging still works and the
  // checklist says which file to generate.
  const coverCandidates = [
    opts.cover,
    path.join(douyinDir, "cover.jpg"),
    path.join(projectRoot, "youtube", "thumbnail-vertical.jpg"),
    path.join(projectRoot, "youtube", "thumbnail.jpg"),
  ].filter((p): p is string => p !== undefined);
  const coverPath = coverCandidates.find((p) => existsSync(p));

  const cfg = loadProviderConfig();
  const reviewCfg = cfg["review"];
  const chosenName = opts.model ?? reviewCfg.primary;
  const fallbackName =
    chosenName === reviewCfg.primary
      ? reviewCfg.fallback
      : chosenName === reviewCfg.fallback
        ? reviewCfg.primary
        : undefined;

  console.log(brandBannerLine());
  console.log(channelHeader(opts.project, "douyin · 抖音"));
  console.log("");

  const result = await callDouyin(
    {
      article: articleMd,
      topic: articleTitle(article.proseBody, article.frontmatter.project),
      hook: extractHook(article.proseBody),
      ...(article.frontmatter.image_style
        ? { imageStyle: article.frontmatter.image_style }
        : {}),
      ...(totalRuntime(rendered, article.frontmatter.duration_target_sec) !==
      undefined
        ? {
            durationSec: totalRuntime(
              rendered,
              article.frontmatter.duration_target_sec,
            ),
          }
        : {}),
    },
    providerInstance(chosenName),
    fallbackName ? providerInstance(fallbackName) : null,
    youtubeCoverPrompt !== undefined ? { youtubeCoverPrompt } : undefined,
  );

  await writeFile(
    path.join(douyinDir, "package.yaml"),
    yamlStringify(result.douyin),
    "utf8",
  );
  await writeFile(
    path.join(douyinDir, "cover-prompt.txt"),
    result.douyin.cover_prompt + "\n",
    "utf8",
  );

  // The upload. Without an access token the command stops at the
  // checklist — a Douyin post is worth more than a failed script.
  let uploadBlocker: string | undefined;
  let publishedId: string | undefined;
  if (opts.upload === true) {
    const token = douyinAccessToken();
    if (token === undefined) {
      uploadBlocker =
        "no DOUYIN_ACCESS_TOKEN — add it to ~/.config/secrets/ai.env, or upload by hand from douyin/CHECKLIST.md";
    } else {
      try {
        const published = await uploadDouyin({
          videoPath,
          ...(coverPath !== undefined ? { coverPath } : {}),
          pkg: result.douyin,
          accessToken: token,
        });
        publishedId = published.item_id;
        await writeFile(
          path.join(douyinDir, "item_id.txt"),
          published.item_id + "\n",
          "utf8",
        );
        if (published.share_url !== undefined) {
          await writeFile(
            path.join(douyinDir, "share_url.txt"),
            published.share_url + "\n",
            "utf8",
          );
        }
      } catch (err) {
        uploadBlocker = (err as Error).message;
      }
    }
  }

  const checklist = renderChecklist({
    pkg: result.douyin,
    videoPath,
    ...(coverPath !== undefined ? { coverPath } : {}),
    ...(result.warning !== undefined ? { warning: result.warning } : {}),
    ...(uploadBlocker !== undefined ? { uploadBlocker } : {}),
  });
  await writeFile(path.join(douyinDir, "CHECKLIST.md"), checklist, "utf8");

  const runId = formatRunId("douyin");
  const { writeRun } = await import("@video/workflow");
  await writeRun(projectRoot, {
    run_id: runId,
    stage: "douyin",
    status: "succeeded" as const,
    actor: "agent" as const,
    tool: "video-douyin",
    input_commit: safeGitHead(projectRoot),
    input_files: ["article.md"],
    output_files: [
      "douyin/package.yaml",
      "douyin/cover-prompt.txt",
      "douyin/CHECKLIST.md",
      ...(publishedId !== undefined ? ["douyin/item_id.txt"] : []),
    ],
    created_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    provider: result.providerName ?? chosenName,
    model: result.providerName ?? chosenName,
    prompt_hash: sha256OfMessages(result.messages),
    tokens: undefined,
    estimated_cost_usd: undefined,
  });

  console.log("");
  console.log(`${MARK_OK} packaged ${path.relative(process.cwd(), douyinDir)}/`);
  console.log(`  title : ${result.douyin.title}`);
  console.log(
    `  topics: ${result.douyin.topics.length > 0 ? result.douyin.topics.map((t) => `#${t}`).join(" ") : "(none — pick manually)"}`,
  );
  console.log(`  video : ${path.relative(process.cwd(), videoPath)}`);
  if (cutNote !== "") console.log(`  note  : ${cutNote}`);
  if (result.source === "fallback") {
    console.log("");
    console.log(`  ⚠ degraded to the deterministic fallback: ${result.warning}`);
  }
  if (publishedId !== undefined) {
    console.log("");
    console.log(`${MARK_OK} published — item id ${publishedId}`);
    console.log(`  → douyin/item_id.txt`);
  } else if (uploadBlocker !== undefined) {
    console.log("");
    console.log(`  ⚠ upload did not run: ${uploadBlocker}`);
    console.log(`  → douyin/CHECKLIST.md has the manual steps`);
  } else {
    console.log("");
    console.log(`  → douyin/CHECKLIST.md for the manual upload steps`);
    console.log(`  → add --upload once DOUYIN_ACCESS_TOKEN is set`);
  }
  return 0;
}

export function registerDouyin(program: Command): void {
  program
    .command("douyin")
    .argument("[project]", "project to package: topic, folder name, or path")
    .description(
      "抖音 (Douyin) submission metadata + the vertical 9:16 cut; publishes through the official API with --upload",
    )
    .option("--cwd <dir>", "base directory for the project")
    .option(
      "--model <provider>",
      "model provider: minimax|glm (default from config)",
    )
    .option(
      "--upload",
      "publish through the official 抖音开放平台 API (needs DOUYIN_ACCESS_TOKEN)",
    )
    .option(
      "--cut-mode <mode>",
      "how the 16:9 master becomes 9:16: inset (blurred backdrop, nothing cropped) | crop (fills the screen, loses the sides)",
    )
    .option("--video <path>", "use this file as the video instead of cutting one")
    .option("--cover <path>", "use this file as the cover")
    .option("--no-cut", "package only — do not cut the master")
    .action(async (project: string | undefined, opts) => {
      if (project === undefined) {
        console.error("douyin requires a project argument");
        process.exitCode = 1;
        return;
      }
      const cutMode = opts.cutMode as VerticalCutMode | undefined;
      if (cutMode !== undefined && cutMode !== "inset" && cutMode !== "crop") {
        console.error(`--cut-mode must be inset or crop (got ${cutMode})`);
        process.exitCode = 1;
        return;
      }
      process.exitCode = await runDouyin({
        project,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.upload !== undefined ? { upload: opts.upload } : {}),
        ...(cutMode !== undefined ? { cutMode } : {}),
        ...(opts.video !== undefined ? { video: opts.video } : {}),
        ...(opts.cover !== undefined ? { cover: opts.cover } : {}),
        ...(opts.cut !== undefined ? { noCut: opts.cut === false } : {}),
      });
    });
}
