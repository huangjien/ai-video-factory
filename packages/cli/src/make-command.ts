import type { Command } from "commander";
import path from "node:path";
import { runMake } from "@video/make";
import { resolveProjectDir } from "./project-path.js";
import {
  MARK_FAIL,
  MARK_OK,
  MARK_RUN,
  MARK_SKIP,
  brandBannerLine,
} from "./ui.js";

export interface MakeOptions {
  project: string;
  cwd?: string;
  fake?: boolean;
  dryRun?: boolean;
  /** Image provider for scene visuals: minimax (real AI), flux (local
   *  FLUX.2 Klein 4B via diffusers), mock, or none. */
  imageProvider?: "minimax" | "flux" | "mock" | "none";
  /** Local music library dir — BGM tags resolve to {tag}.wav inside it. */
  bgmDir?: string;
  /** Local SFX library dir — same lookup rule as bgmDir. */
  sfxDir?: string;
  /** BGM generation: auto (MiniMax when key present) | minimax | mock. */
  musicProvider?: "auto" | "minimax" | "mock";
  /** Absolute path to lora-config.yaml for the flux provider. */
  loraConfigPath?: string;
  /** Legacy: LoRA adapters as "path[:scale][,path2[:scale2]]". */
  lora?: string;
}

export async function runMakeCli(opts: MakeOptions): Promise<number> {
  const resolvedProject = resolveProjectDir(opts.project, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    return 1;
  }
  const projectRoot = resolvedProject.root;

  const report = await runMake({
    projectRoot,
    ...(opts.fake !== undefined ? { fake: opts.fake } : {}),
    ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
    ...(opts.imageProvider !== undefined
      ? { imageProvider: opts.imageProvider }
      : {}),
    ...(opts.bgmDir !== undefined ? { bgmDir: opts.bgmDir } : {}),
    ...(opts.sfxDir !== undefined ? { sfxDir: opts.sfxDir } : {}),
    ...(opts.musicProvider !== undefined
      ? { musicProvider: opts.musicProvider }
      : {}),
  });

  // Pretty-print the report. Marks come from the shared ui module so the
  // operator reads the same vocabulary across `video status / make / qa`.
  console.log(brandBannerLine());
  console.log(`▷ ${opts.project}  ·  make`);
  console.log("");
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
  console.log(`\nmake: done`);
  return 0;
}

export function registerMake(program: Command): void {
program
  .command("make")
  .argument(
    "<project>",
    "project: topic, folder name, path, or unique prefix (defaults to cwd-discovered single project)",
  )
  .option("--cwd <dir>", "base directory for the project")
  .option(
    "--fake",
    "use FakeTTSProvider (no Edge-TTS network call) — produces silent placeholder WAVs",
  )
  .option(
    "--image-provider <provider>",
    "image provider for scene visuals: minimax (real AI), flux (local FLUX.2 Klein 4B, no quota), mock, none (default: minimax; --fake implies none)",
  )
  .option(
    "--bgm-dir <dir>",
    "local BGM library dir — the bgm tag from audio-config.yaml resolves to {tag}.wav inside it (default: mock silent placeholder)",
  )
  .option(
    "--sfx-dir <dir>",
    "local SFX library dir — sfx cue tags resolve to {tag}.wav inside it (default: mock silent placeholder)",
  )
  .option(
    "--music-provider <mode>",
    "BGM generation: auto (MiniMax music gen when MINIMAX_API_KEY set, else mock) | minimax | mock",
    (v) => {
      if (v !== "auto" && v !== "minimax" && v !== "mock") {
        throw new Error(`--music-provider must be auto|minimax|mock, got: ${v}`);
      }
      return v as "auto" | "minimax" | "mock";
    },
  )
  .option(
    "--dry-run",
    "log which steps would run without executing them",
  )
  .option(
    "--lora-config <path>",
    "absolute path to a lora-config.yaml for the flux image provider (overrides <projectRoot>/lora-config.yaml and <repo>/lora-config.yaml)",
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
        fake?: boolean;
        imageProvider?: "minimax" | "flux" | "mock" | "none";
        bgmDir?: string;
        sfxDir?: string;
        musicProvider?: "auto" | "minimax" | "mock";
        dryRun?: boolean;
        loraConfig?: string;
        lora?: string;
      },
    ) => {
      process.exitCode = await runMakeCli({
        project,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.fake !== undefined ? { fake: opts.fake } : {}),
        ...(opts.imageProvider !== undefined
          ? { imageProvider: opts.imageProvider }
          : {}),
        ...(opts.bgmDir !== undefined ? { bgmDir: opts.bgmDir } : {}),
        ...(opts.sfxDir !== undefined ? { sfxDir: opts.sfxDir } : {}),
        ...(opts.musicProvider !== undefined
          ? { musicProvider: opts.musicProvider }
          : {}),
        ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
        ...(opts.loraConfig !== undefined
          ? { loraConfigPath: opts.loraConfig }
          : {}),
        ...(opts.lora !== undefined ? { lora: opts.lora } : {}),
      });
    },
  );
}
