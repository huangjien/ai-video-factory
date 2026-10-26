import type { Command } from "commander";
import path from "node:path";
import { computeMakeImpact, formatImpact, runMake } from "@video/make";
import { resolveProjectDir } from "./project-path.js";
import { l10nRootOrThrow } from "./translate-command.js";
import {
  MARK_FAIL,
  MARK_OK,
  MARK_RUN,
  MARK_SKIP,
  brandBannerLine,
  formatProgressEvent,
} from "./ui.js";

export interface MakeOptions {
  project: string;
  cwd?: string;
  fake?: boolean;
  dryRun?: boolean;
  /** Render the translated variant in l10n/<lang>/ (see video translate). */
  lang?: string;
  /** Image provider for scene visuals: minimax (real AI), openai, gemini,
   *  mock, or none. */
  imageProvider?: "minimax" | "openai" | "gemini" | "mock" | "none";
  /** Local music library dir — BGM tags resolve to {tag}.wav inside it. */
  bgmDir?: string;
  /** Local SFX library dir — same lookup rule as bgmDir. */
  sfxDir?: string;
  /** BGM generation: auto (MiniMax when key present) | minimax | mock. */
}

export async function runMakeCli(opts: MakeOptions): Promise<number> {
  const resolvedProject = resolveProjectDir(opts.project, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    return 1;
  }
  // Multi-language (2026-10-26): `--lang en-US` runs make against the
  // language workdir l10n/<lang>/ (created by `video translate`), which is
  // itself a full project root sharing the canonical image set — so image
  // caches hit and only TTS/render re-spend per language.
  let projectRoot = resolvedProject.root;
  if (opts.lang !== undefined) {
    try {
      projectRoot = l10nRootOrThrow(resolvedProject.root, opts.lang);
    } catch (err) {
      console.error((err as Error).message);
      return 1;
    }
  }

  // Banner BEFORE the run: the first live progress lines arrive with
  // project context, and watchers (agents polling output) know which
  // project is producing them.
  console.log(brandBannerLine());
  console.log(`▷ ${opts.project}  ·  make`);
  console.log("");

  const report = await runMake({
    // video-progress/1: live step/scene/heartbeat lines on stderr; the
    // final report table below stays the authoritative summary.
    onEvent: (e) => console.error(formatProgressEvent(e)),
    projectRoot,
    ...(opts.fake !== undefined ? { fake: opts.fake } : {}),
    ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
    ...(opts.imageProvider !== undefined
      ? { imageProvider: opts.imageProvider }
      : {}),
    ...(opts.bgmDir !== undefined ? { bgmDir: opts.bgmDir } : {}),
    ...(opts.sfxDir !== undefined ? { sfxDir: opts.sfxDir } : {}),
  });

  // Pretty-print the report. Marks come from the shared ui module so the
  // operator reads the same vocabulary across `video status / make / qa`.
  for (const s of report.steps) {
    const tag =
      s.status === "ran"
        ? MARK_OK
        : s.status === "skip"
          ? MARK_SKIP
          : s.status === "would-run"
            ? MARK_RUN
            : MARK_FAIL;
    const line = `  ${tag} ${s.name}` + (s.message ? `: ${s.message}` : "");
    console.log(line);
    for (const o of s.outputs ?? []) console.log(`      ${o}`);
  }
  const failed = report.steps.filter((s) => s.status === "fail");
  if (failed.length > 0) {
    console.error(
      `\nmake: ${failed.length} step(s) failed — fix and re-run \`video make ${opts.project}\``,
    );
    return 1;
  }
  // v0.8 (G2): with --dry-run, the step list says "would-run" — the impact
  // table says WHAT would actually happen (images/scenes/TTS vs caches,
  // visuals gate, storyboard drift). Read-only: no provider constructed.
  if (opts.dryRun === true) {
    try {
      const impact = computeMakeImpact(projectRoot, {
        ...(opts.imageProvider !== undefined
          ? { imageProvider: opts.imageProvider }
          : {}),
        ...(opts.fake !== undefined ? { fake: opts.fake } : {}),
      });
      console.log("\nimpact (nothing executed):");
      for (const line of formatImpact(impact)) console.log(`  ${line}`);
    } catch (err) {
      console.error(`impact: ${(err as Error).message}`);
    }
  }
  console.log(`\nmake: done`);
  return 0;
}

export function registerMake(program: Command): void {
  program
    .command("make")
    .argument(
      "<project>",
      "project: topic, folder name, path, or unique prefix (required)",
    )
    .option("--cwd <dir>", "base directory for the project")
    .option(
      "--fake",
      "use FakeTTSProvider (no Edge-TTS network call) — produces silent placeholder WAVs",
    )
    .option(
      "--image-provider <provider>",
      "image provider for scene visuals: minimax (image-01, default since v0.8.1; needs MINIMAX_API_KEY), openai (gpt-image-2.5-flare; needs OPENAI_API_KEY), gemini (gemini-3.1-flash-image; needs GEMINI_API_KEY), mock, none (--fake implies none)",
    )
    .option(
      "--bgm-dir <dir>",
      "local BGM library dir — the bgm tag from audio-config.yaml resolves to {tag}.wav inside it (default: mock silent placeholder)",
    )
    .option(
      "--sfx-dir <dir>",
      "local SFX library dir — sfx cue tags resolve to {tag}.wav inside it (default: mock silent placeholder)",
    )
    .option("--dry-run", "log which steps would run without executing them")
    .option(
      "--lang <lang>",
      "render a translated language variant from l10n/<lang>/ (created by `video translate`) — same shared images, per-language narration/captions/output",
    )
    .action(
      async (
        project: string,
        opts: {
          cwd?: string;
          fake?: boolean;
          imageProvider?: "minimax" | "openai" | "gemini" | "mock" | "none";
          bgmDir?: string;
          sfxDir?: string;
          dryRun?: boolean;
          lang?: string;
        },
      ) => {
        process.exitCode = await runMakeCli({
          project,
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.fake !== undefined ? { fake: opts.fake } : {}),
          ...(opts.imageProvider !== undefined
            ? { imageProvider: opts.imageProvider }
            : {}),
          ...(opts.bgmDir !== undefined
            ? { bgmDir: opts.bgmDir }
            : {}),
          ...(opts.sfxDir !== undefined
            ? { sfxDir: opts.sfxDir }
            : {}),
          ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
          ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
        });
      },
    );
}
