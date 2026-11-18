import type { Command } from "commander";
import { resolveProjectDir } from "./project-path.js";
import {
  loadAudioConfig,
  mixOptionsFromAudioConfig,
  mixProject,
  parseSfxFlags,
  resolveLibraryBgm,
  type MixProjectOptions,
} from "@video/make";

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

/**
 * The mix options for a project: `audio-config.yaml` first, then the
 * flags on top.
 *
 * The config is the SOURCE (it is one of the two human-edit files, and
 * it is what `video make`'s mix step reads); the flags are overrides.
 * Before this, the command read neither the config nor the SFX cues —
 * it read mix.yaml, a file the pipeline does not write — so a project
 * configured with `bgm: light-gravity` and two SFX cues mixed a
 * DIFFERENT track with no cues (measured 2026-11-16).
 */
export async function mixOptionsForProject(
  projectRoot: string,
  flags: {
    bgmPath?: string | undefined;
    bgmAttenuationDb?: number | undefined;
    mixYamlPath?: string | undefined;
    bgmFadeInSec?: number | undefined;
    bgmFadeOutSec?: number | undefined;
    sfx?: string[] | undefined;
  },
): Promise<MixProjectOptions> {
  const config = await loadAudioConfig(projectRoot);
  const fromConfig = await mixOptionsFromAudioConfig(projectRoot, config);
  let flagSfx: Record<string, string> | undefined;
  if (flags.sfx !== undefined) {
    const parsed = parseSfxFlags(flags.sfx);
    if (Object.keys(parsed).length > 0) flagSfx = parsed;
  }
  return {
    ...fromConfig,
    ...(flags.bgmPath !== undefined
      ? { bgmPath: await resolveBgmOption(projectRoot, flags.bgmPath) }
      : {}),
    ...(flags.bgmAttenuationDb !== undefined
      ? { bgmAttenuationDb: flags.bgmAttenuationDb }
      : {}),
    ...(flags.mixYamlPath !== undefined
      ? { mixYamlPath: flags.mixYamlPath }
      : {}),
    ...(flags.bgmFadeInSec !== undefined
      ? { bgmFadeInSec: flags.bgmFadeInSec }
      : {}),
    ...(flags.bgmFadeOutSec !== undefined
      ? { bgmFadeOutSec: flags.bgmFadeOutSec }
      : {}),
    // The flag wins on the same scene; the config's other cues stay.
    ...(flagSfx !== undefined
      ? { sfx: { ...(fromConfig.sfx ?? {}), ...flagSfx } }
      : {}),
  };
}

/** A `--bgm` value is a FILE PATH when it looks like one; anything else
 *  is a library tag and gets resolved like the config's `bgm:`. */
async function resolveBgmOption(
  projectRoot: string,
  value: string,
): Promise<string> {
  const looksLikePath =
    /[\\/]/.test(value) || /\.(wav|mp3|m4a|ogg|flac)$/i.test(value);
  return looksLikePath ? value : resolveLibraryBgm(projectRoot, value);
}

export async function runMix(opts: MixOptions): Promise<number> {
  const resolvedProject = resolveProjectDir(opts.project, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    return 1;
  }
  const projectRoot = resolvedProject.root;
  let mixOpts: MixProjectOptions;
  try {
    mixOpts = await mixOptionsForProject(projectRoot, {
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
      ...(opts.sfx !== undefined ? { sfx: opts.sfx } : {}),
    });
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
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
      "explicit BGM file or library tag (default: audio-config.yaml's `bgm:`, then the first .wav in assets/audio-assets/bgm/)",
    )
    .option(
      "--bgm-attenuation <db>",
      "BGM attenuation in dB while narration is silent (default -18)",
      (v) => Number.parseFloat(v),
    )
    .option(
      "--bgm-fade-in <sec>",
      "fade BGM in over N seconds (overrides audio-config.yaml)",
      (v) => Number.parseFloat(v),
    )
    .option(
      "--bgm-fade-out <sec>",
      "fade BGM out over last N seconds (overrides audio-config.yaml)",
      (v) => Number.parseFloat(v),
    )
    .option(
      "--mix-yaml <path>",
      "LEGACY: explicit path to audio-assets/mix.yaml (a v0.3.5 file the pipeline no longer writes — it only fills the gaps audio-config.yaml leaves)",
    )
    .option(
      "--sfx <scene_N=tag>",
      "SFX cue, repeatable (e.g. --sfx scene_2=whoosh). Merged with audio-config.yaml's and mix.yaml's cues; the flag wins on the same scene.",
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
