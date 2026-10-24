import type { Command } from "commander";
import { resolveProjectDir } from "./project-path.js";
import { mixProject, parseSfxFlags, type MixProjectOptions } from "@video/make";

// The mix operation itself (narration selection, BGM resolution, cue
// placement, ffmpeg, run record, artifact check) lives in @video/make —
// the same in-process call `video make`'s mix step uses. Re-exported
// here so existing importers (tests, `video audio-asset`) keep working.
export {
  listAvailableBgms,
  parseSfxFlags,
  pickNarrations,
  resolveBgmByTag,
} from "@video/make";

export interface MixOptions {
  project: string;
  cwd?: string | undefined;
  bgmPath?: string | undefined;
  bgmAttenuationDb?: number;
  mixYamlPath?: string | undefined;
  bgmFadeInSec?: number;
  bgmFadeOutSec?: number;
  /** SFX cues as `scene_N=tag`. `video make` passes audio-config.yaml's
   *  `sfx:` block through here — the documented place for cues, and the
   *  one the mix actually reads. */
  sfx?: string[] | undefined;
}

export async function runMix(opts: MixOptions): Promise<number> {
  const resolvedProject = resolveProjectDir(opts.project, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    return 1;
  }
  const projectRoot = resolvedProject.root;
  let sfx: Record<string, string> | undefined;
  try {
    const parsed = parseSfxFlags(opts.sfx);
    if (Object.keys(parsed).length > 0) sfx = parsed;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
  const mixOpts: MixProjectOptions = {
    ...(opts.bgmPath !== undefined ? { bgmPath: opts.bgmPath } : {}),
    ...(opts.bgmAttenuationDb !== undefined
      ? { bgmAttenuationDb: opts.bgmAttenuationDb }
      : {}),
    ...(opts.mixYamlPath !== undefined
      ? { mixYamlPath: opts.mixYamlPath }
      : {}),
    ...(opts.bgmFadeInSec !== undefined
      ? { bgmFadeInSec: opts.bgmFadeInSec }
      : {}),
    ...(opts.bgmFadeOutSec !== undefined
      ? { bgmFadeOutSec: opts.bgmFadeOutSec }
      : {}),
    ...(sfx !== undefined ? { sfx } : {}),
  };
  const outcome = await mixProject(projectRoot, mixOpts);
  for (const warning of outcome.warnings) console.error(`  ! ${warning}`);
  if (!outcome.ok) {
    for (const line of outcome.lines) console.error(line);
    if (outcome.error !== "") console.error(`✗ ${outcome.error}`);
    return 1;
  }
  for (const line of outcome.lines) console.log(line);
  return 0;
}

export function registerMix(program: Command): void {
  program
    .command("mix")
    .argument(
      "<project>",
      "project: topic, folder name, path, or unique prefix",
    )
    .option("--cwd <dir>", "base directory for the project")
    .option(
      "--bgm <path>",
      "explicit BGM file (default: first .wav in assets/audio-assets/bgm/ or bgm tag from audio-assets/mix.yaml)",
    )
    .option(
      "--bgm-attenuation <db>",
      "BGM attenuation in dB while narration is silent (default -18)",
      (v) => Number.parseFloat(v),
    )
    .option(
      "--bgm-fade-in <sec>",
      "fade BGM in over N seconds (overrides mix.yaml)",
      (v) => Number.parseFloat(v),
    )
    .option(
      "--bgm-fade-out <sec>",
      "fade BGM out over last N seconds (overrides mix.yaml)",
      (v) => Number.parseFloat(v),
    )
    .option(
      "--mix-yaml <path>",
      "explicit mix.yaml path (default: audio-assets/mix.yaml)",
    )
    .option(
      "--sfx <scene_N=tag>",
      "SFX cue, repeatable (e.g. --sfx scene_2=whoosh). Merged with mix.yaml cues; the flag wins on the same scene.",
      (v: string, prev: string[] = []) => [...prev, v],
    )
    .action(
      async (
        project: string,
        opts: {
          cwd?: string;
          bgm?: string;
          bgmAttenuation?: number;
          bgmFadeIn?: number;
          bgmFadeOut?: number;
          mixYaml?: string;
          sfx?: string[];
        },
      ) => {
        process.exitCode = await runMix({
          project,
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.bgm !== undefined ? { bgmPath: opts.bgm } : {}),
          ...(opts.bgmAttenuation !== undefined
            ? { bgmAttenuationDb: opts.bgmAttenuation }
            : {}),
          ...(opts.bgmFadeIn !== undefined
            ? { bgmFadeInSec: opts.bgmFadeIn }
            : {}),
          ...(opts.bgmFadeOut !== undefined
            ? { bgmFadeOutSec: opts.bgmFadeOut }
            : {}),
          ...(opts.mixYaml !== undefined ? { mixYamlPath: opts.mixYaml } : {}),
          ...(opts.sfx !== undefined ? { sfx: opts.sfx } : {}),
        });
      },
    );
}
