import type { Command } from "commander";
import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { resolveProjectDir } from "./project-path.js";
import { mixTracks, mixTracksWithSpec, parseMixYaml } from "@video/audio-mix";
import { formatRunId } from "@video/workflow";
import {
  curatedBgmDirectory,
  resolveBgmTag,
  SUPPORTED_AUDIO_EXTENSIONS,
  type LocalBgmEntry,
  type ResolvedBgm,
} from "@video/audio-assets";

const execFileAsync = promisify(execFile);

export interface MixOptions {
  project: string;
  cwd?: string | undefined;
  bgmPath?: string | undefined;
  bgmAttenuationDb?: number;
  mixYamlPath?: string | undefined;
  bgmFadeInSec?: number;
  bgmFadeOutSec?: number;
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** First .wav/.mp3/.m4a in the curated BGM library (assets/bgm/), or the
 *  project-local override (assets/audio-assets/bgm/), in priority order.
 *  Since v2026-10-18 the curated library ships as mp3 (matches the
 *  existing assets/brand/ convention) and any single supported extension
 *  is accepted here. */
function pickBgm(projectRoot: string, explicit?: string): string {
  if (explicit) return explicit;
  const projectDir = path.join(projectRoot, "assets", "audio-assets", "bgm");
  const repoRoot = repoRootOf(projectRoot);
  const curatedDir = curatedBgmDirectory(repoRoot);

  // Project-local first: a project's own generated/mixed BGM shadows the
  // curated library without deleting the canonical file.
  const localCandidates = existsSync(projectDir)
    ? readdirSync(projectDir)
        .filter((f) =>
          SUPPORTED_AUDIO_EXTENSIONS.some((ext) =>
            f.toLowerCase().endsWith(ext),
          ),
        )
        .map((f) => path.join(projectDir, f))
        .sort()
    : [];
  if (localCandidates.length > 0) return localCandidates[0] ?? "";

  // Curated fallback. The library is the project's single source of
  // truth for BGM — every project should resolve to one of these tags.
  if (existsSync(curatedDir)) {
    const curated = readdirSync(curatedDir)
      .filter((f) =>
        SUPPORTED_AUDIO_EXTENSIONS.some((ext) =>
          f.toLowerCase().endsWith(ext),
        ),
      )
      .map((f) => path.join(curatedDir, f))
      .sort();
    if (curated.length > 0) return curated[0] ?? "";
  }
  throw new Error(
    `no BGM found: pass --bgm <path>, drop a file in ${curatedDir}, or run \`video audio-asset --bgm <tag>\` first`,
  );
}

/** Walk up from the project root to find the repo root (the directory
 *  that owns `package.json`). Falls back to the project root when not
 *  found (e.g. when the CLI is run outside the monorepo). */
function repoRootOf(projectRoot: string): string {
  let dir = projectRoot;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return projectRoot;
}

/** Resolve a BGM *tag* (e.g. "calm", "ambient-take-your-pick") to a real
 *  file path. Used by the BGM-by-tag resolution path: `audio-config.yaml`
 *  `bgm:` and the first entry of `bgm_tracks[*].track` may carry either a
 *  bare tag or a path; this helper handles the tag case. */
export function resolveBgmByTag(
  projectRoot: string,
  tag: string,
): ResolvedBgm {
  const repoRoot = repoRootOf(projectRoot);
  return resolveBgmTag({
    tag,
    projectDir: path.join(projectRoot, "assets", "audio-assets", "bgm"),
    curatedDir: curatedBgmDirectory(repoRoot),
  });
}

/** List the curated library and project-local library, deduplicating by
 *  tag with project-local first. Tests + future `video audio list-bgms`
 *  commands pull this. */
export function listAvailableBgms(projectRoot: string): LocalBgmEntry[] {
  const repoRoot = repoRootOf(projectRoot);
  const projectLibrary = loadLibraryAllowingMissing(
    path.join(projectRoot, "assets", "audio-assets", "bgm"),
  );
  const curatedLibrary = loadLibraryAllowingMissing(
    curatedBgmDirectory(repoRoot),
  );
  const seen = new Set<string>();
  const out: LocalBgmEntry[] = [];
  for (const e of projectLibrary) {
    if (!seen.has(e.tag)) {
      seen.add(e.tag);
      out.push(e);
    }
  }
  for (const e of curatedLibrary) {
    if (!seen.has(e.tag)) {
      seen.add(e.tag);
      out.push(e);
    }
  }
  return out;
}

function loadLibraryAllowingMissing(directory: string): LocalBgmEntry[] {
  if (!existsSync(directory)) return [];
  // Lightweight reimplementation that does NOT depend on the
  // audio-assets package internals to avoid a circular import boundary
  // (the CLI is the integrator; the package owns the parser). Keeps the
  // shape identical to `loadLocalBgmLibrary` in local-library.ts.
  const seen = new Set<string>();
  const out: LocalBgmEntry[] = [];
  for (const file of readdirSync(directory).sort()) {
    const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
    if (
      ext !== ".wav" &&
      ext !== ".mp3" &&
      ext !== ".m4a"
    ) {
      continue;
    }
    const tag = file.slice(0, -ext.length);
    if (seen.has(tag)) continue;
    seen.add(tag);
    const dashIdx = tag.indexOf("-");
    out.push({
      tag,
      mood: dashIdx > 0 ? tag.slice(0, dashIdx) : "uncategorized",
      path: path.join(directory, file),
      durationSec: null,
    });
  }
  return out;
}

/** Scene number from a narration wav name — the numeric sort key.
 * "scene_2.wav" → 2, "scene-10.wav" → 10 (separator/padding agnostic). */
function sceneWavNumber(f: string): number {
  const m = f.match(/^scene[-_](\d+)\.wav$/);
  return m ? parseInt(m[1]!, 10) : Number.MAX_SAFE_INTEGER;
}

/** Narration wavs for the mix concat, in SCENE order. Numeric sort is
 * load-bearing: lexicographic order interleaves scene_10..scene_14 between
 * scene_1 and scene_2 whenever a video has ≥10 scenes, so the mixed audio
 * track stops matching the visual/caption timeline (observed 2026-10-16:
 * "audio has nothing to do with images and subtitle"). */
export function pickNarrations(projectRoot: string): string[] {
  const audioDir = path.join(projectRoot, "assets", "audio");
  if (!existsSync(audioDir)) {
    throw new Error(
      `no narration audio in ${audioDir} — run \`video audio <project>\` first`,
    );
  }
  const files = readdirSync(audioDir)
    .filter((f) => /^scene[-_]\d+\.wav$/.test(f))
    .sort((a, b) => sceneWavNumber(a) - sceneWavNumber(b) || a.localeCompare(b))
    .map((f) => path.join(audioDir, f));
  if (files.length === 0) {
    throw new Error(`no scene-N.wav files in ${audioDir}`);
  }
  return files;
}

/** Parse a spec's SFX cues into engine cues by translating scene_N tags into
 * absolute seconds based on the accumulated narration duration. */
function resolveSfxCues(
  specSfx: Record<string, string> | undefined,
  projectRoot: string,
  sfxDir: string,
  narrationPaths: string[],
  narrationDurationsSec: number[],
): { atSec: number; path: string }[] {
  if (!specSfx) return [];
  const cues: { atSec: number; path: string }[] = [];
  let cumulative = 0;
  for (let i = 0; i < narrationPaths.length; i++) {
    const sceneKey = `scene_${i + 1}`;
    const tag = specSfx[sceneKey];
    if (tag) {
      const tagFile = path.join(sfxDir, `${tag}.wav`);
      if (!existsSync(tagFile)) {
        throw new Error(
          `SFX cue "${tag}" for ${sceneKey} not found at ${tagFile} — run \`video audio-asset --sfx ${tag}\` first`,
        );
      }
      cues.push({ atSec: cumulative, path: tagFile });
    }
    cumulative += narrationDurationsSec[i] ?? 0;
  }
  return cues;
}

/** Probe per-narration durations so SFX cues land at concrete timestamps.
 * Throws when ffprobe fails or returns garbage — returning 0 here would
 * silently collapse every cue onto t=0. */
async function probeTotalDuration(
  narrationPaths: string[],
): Promise<number[]> {
  return Promise.all(
    narrationPaths.map(async (p) => {
      const { stdout } = await execFileAsync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "a:0",
          "-show_entries",
          "stream=duration",
          "-of",
          "csv=p=0",
          p,
        ],
      );
      const seconds = parseFloat(stdout.trim());
      if (!Number.isFinite(seconds)) {
        throw new Error(`ffprobe could not parse a duration for ${p}`);
      }
      return seconds;
    }),
  );
}

export async function runMix(opts: MixOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const resolvedProject = resolveProjectDir(opts.project, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    return 1;
  }
  const projectRoot = resolvedProject.root;
  let narrationPaths: string[];
  let bgmPath: string;
  try {
    narrationPaths = pickNarrations(projectRoot);
    bgmPath = pickBgm(projectRoot, opts.bgmPath);
  } catch (err) {
    console.error(`\u2717 ${(err as Error).message}`);
    return 1;
  }

  // Read mix.yaml (optional) — overrides BGM selection and may define SFX cues
  // + fade durations. CLI flags override the spec where set.
  const mixYamlPath =
    opts.mixYamlPath ?? path.join(projectRoot, "audio-assets", "mix.yaml");
  let spec = null;
  if (existsSync(mixYamlPath)) {
    const { readFile } = await import("node:fs/promises");
    const yamlText = await readFile(mixYamlPath, "utf8");
    try {
      spec = parseMixYaml(yamlText);
    } catch (err) {
      console.error(`\u2717 ${(err as Error).message}`);
      return 1;
    }
    if (!opts.bgmPath && spec.bgm) {
      // pickBgm returns explicit paths without an existence check, so a
      // spec naming a missing track used to hand ffmpeg a dead path and
      // the fallback below could never fire. Check here instead.
      const specBgm = path.join(
        projectRoot,
        "assets",
        "audio-assets",
        "bgm",
        `${spec.bgm}.wav`,
      );
      if (existsSync(specBgm)) {
        bgmPath = specBgm;
      } else {
        console.error(
          `  ! mix.yaml bgm "${spec.bgm}" not found at ${specBgm} — falling back to ${path.basename(bgmPath)}`,
        );
      }
    }
  }

  const fadeIn = opts.bgmFadeInSec ?? spec?.bgm_fade_in_sec ?? 0;
  const fadeOut = opts.bgmFadeOutSec ?? spec?.bgm_fade_out_sec ?? 0;
  const sfxDir = path.join(projectRoot, "assets/audio-assets/sfx");
  let sfxCues: { atSec: number; path: string }[];
  try {
    // Durations are only needed to place SFX cues — probe (and fail loudly
    // on error) only when the spec actually defines cues.
    const narrationDurationsSec = spec?.sfx
      ? await probeTotalDuration(narrationPaths)
      : [];
    sfxCues = resolveSfxCues(
      spec?.sfx,
      projectRoot,
      sfxDir,
      narrationPaths,
      narrationDurationsSec,
    );
  } catch (err) {
    console.error(`\u2717 ${(err as Error).message}`);
    return 1;
  }

  const outPath = path.join(projectRoot, "output", "final-mixed.mp4");
  await mkdir(path.dirname(outPath), { recursive: true });

  const previewPath = path.join(projectRoot, "output", "preview.mp4");
  const videoPath = existsSync(previewPath) ? previewPath : undefined;

  try {
    if (sfxCues.length > 0 || fadeIn > 0 || fadeOut > 0) {
      await mixTracksWithSpec({
        narrationPaths,
        bgmPath,
        outPath,
        ...(videoPath !== undefined ? { videoPath } : {}),
        sfxCues,
        bgmFadeInSec: fadeIn,
        bgmFadeOutSec: fadeOut,
        ...(opts.bgmAttenuationDb !== undefined
          ? { bgmAttenuationDb: opts.bgmAttenuationDb }
          : {}),
      });
    } else {
      await mixTracks({
        narrationPaths,
        bgmPath,
        outPath,
        ...(videoPath !== undefined ? { videoPath } : {}),
        ...(opts.bgmAttenuationDb !== undefined
          ? { bgmAttenuationDb: opts.bgmAttenuationDb }
          : {}),
      });
    }
  } catch (err) {
    console.error(`\u2717 audio mix failed:`, (err as Error).message);
    return 1;
  }

  // Run record
  const runId = formatRunId("audio-mix");
  const promptHash =
    "sha256:" +
    createHash("sha256")
      .update(
        `bgm=${bgmPath}|narr=${narrationPaths.join(",")}|spec=${spec ? "yes" : "no"}|sfx=${sfxCues.length}|fade=${fadeIn},${fadeOut}`,
      )
      .digest("hex");
  const record = {
    run_id: runId,
    stage: "audio-mix",
    status: "succeeded" as const,
    actor: "tool" as const,
    tool: "ffmpeg-mix",
    input_commit: safeGitHead(projectRoot),
    input_files: [
      ...narrationPaths.map((p) => path.relative(projectRoot, p)),
      path.relative(projectRoot, bgmPath),
      ...sfxCues.map((c) => path.relative(projectRoot, c.path)),
    ],
    output_files: ["output/final-mixed.mp4"],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: "ffmpeg",
    model: "amix+sidechaincompress",
    prompt_hash: promptHash,
    tokens: { input: 0, output: 0 },
    estimated_cost_usd: 0,
  };
  const { writeRun } = await import("@video/workflow");
  await writeRun(projectRoot, record);

  console.log(`\u2713 mixed ${opts.project}/output/final-mixed.mp4`);
  console.log(
    `  narration=${narrationPaths.length} files  bgm=${path.basename(bgmPath)}  sfx=${sfxCues.length} cues  fade=${fadeIn}s/${fadeOut}s`,
  );
console.log(
     `  next: this is the audio you ship`,
   );
  return 0;
}

export function registerMix(program: Command): void {
program
  .command("mix")
  .argument("<project>", "project: topic, folder name, path, or unique prefix")
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
      });
    },
  );
}
