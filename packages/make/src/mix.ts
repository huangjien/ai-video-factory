import { execSync } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { formatRunId, writeRun } from "@video/workflow";
import {
  mixTracks,
  mixTracksWithSpec,
  parseMixYaml,
  SfxCueKeySchema,
} from "@video/audio-mix";
import {
  curatedBgmDirectory,
  resolveBgmTag,
  SUPPORTED_AUDIO_EXTENSIONS,
  type LocalBgmEntry,
  type ResolvedBgm,
} from "@video/audio-assets";

const execFileAsync = promisify(execFile);

/**
 * The mix operation in one module — the same code behind `video mix`
 * (CLI) and `video make`'s mix step (in-process). Until 2026-10-24 the
 * make step shelled out to the BUILT CLI (`node packages/cli/dist/...`),
 * a hidden make→cli dependency that needed `pnpm build` first and
 * translated audio-config.yaml into CLI flags — a second copy of mix
 * semantics that could drift from the verb. `mixProject` is the seam both
 * entry points share; it owns narration selection, BGM resolution,
 * mix.yaml merging, SFX cue placement, the ffmpeg call, the run record,
 * and the output-artifact check.
 */

export interface MixOutcome {
  ok: boolean;
  /** Progress + result lines, already formatted for the user. */
  lines: string[];
  /** Non-fatal notes (e.g. mix.yaml bgm fallback). */
  warnings: string[];
  /** Fatal message when ok is false ("" for silent failures). */
  error: string;
  /** Files written on success (project-relative). */
  outputs: string[];
}

export interface MixProjectOptions {
  /** Explicit BGM file — an already-resolved tag or timeline. When
   *  omitted, mix.yaml's `bgm:` and then the library default apply. */
  bgmPath?: string;
  bgmAttenuationDb?: number;
  bgmFadeInSec?: number;
  bgmFadeOutSec?: number;
  /** Explicit mix.yaml path (default: audio-assets/mix.yaml). */
  mixYamlPath?: string;
  /** SFX cues as scene_N → tag (validated against the mix.yaml cue-key
   *  schema — a mis-keyed cue fails loudly instead of being dropped). */
  sfx?: Record<string, string>;
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
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
        SUPPORTED_AUDIO_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)),
      )
      .map((f) => path.join(curatedDir, f))
      .sort();
    if (curated.length > 0) return curated[0] ?? "";
  }
  throw new Error(
    `no BGM found: pass --bgm <path>, drop a file in ${curatedDir}, or run \`video audio-asset --bgm <tag>\` first`,
  );
}

/** Resolve a BGM *tag* (e.g. "calm", "ambient-take-your-pick") to a real
 * file path. Used by the BGM-by-tag resolution path: `audio-config.yaml`
 * `bgm:` and the first entry of `bgm_tracks[*].track` may carry either a
 * bare tag or a path; this helper handles the tag case. */
export function resolveBgmByTag(projectRoot: string, tag: string): ResolvedBgm {
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
    if (ext !== ".wav" && ext !== ".mp3" && ext !== ".m4a") {
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
 * "audio has nothing to do with images and subtitle").
 *
 * The scene LIST comes from storyboard.yaml, not from the directory
 * listing. A re-draft that shrinks the video (49 scenes → 24) leaves the
 * old scene_25..scene_49.wav files on disk; globbing picked those up and
 * concatenated them AFTER the current narration, so the mixed audio ran
 * 256 s longer than the rendered video. The container then advertised the
 * longer audio duration while the video stream ended early, and the last
 * four minutes played as a frozen final frame (observed 2026-10-22).
 * Reading the storyboard makes the two timelines the same length by
 * construction: one scene, one wav, in the storyboard's order. */
export function pickNarrations(projectRoot: string): string[] {
  const audioDir = path.join(projectRoot, "assets", "audio");
  if (!existsSync(audioDir)) {
    throw new Error(
      `no narration audio in ${audioDir} — run \`video audio <project>\` first`,
    );
  }
  const onDisk = readdirSync(audioDir).filter((f) =>
    /^scene[-_]\d+\.wav$/.test(f),
  );
  if (onDisk.length === 0) {
    throw new Error(`no scene-N.wav files in ${audioDir}`);
  }
  // Index the on-disk wavs by scene number. Zero-padded and unpadded
  // names both land on the same key ("scene_01" and "scene_1" → 1).
  const byNumber = new Map<number, string>();
  for (const f of onDisk) {
    byNumber.set(sceneWavNumber(f), path.join(audioDir, f));
  }
  // The storyboard is the authority on which scenes exist and in what
  // order. Fall back to the directory listing only when there is no
  // storyboard to read (a bare `video mix` on a project mid-draft).
  const sceneNumbers = readStoryboardSceneNumbers(projectRoot);
  const numbers =
    sceneNumbers !== null && sceneNumbers.length > 0
      ? sceneNumbers
      : [...byNumber.keys()].sort((a, b) => a - b);
  const files: string[] = [];
  const missing: number[] = [];
  for (const n of numbers) {
    const f = byNumber.get(n);
    if (f === undefined) {
      missing.push(n);
      continue;
    }
    files.push(f);
  }
  if (missing.length > 0) {
    throw new Error(
      `narration audio missing for scene(s) ${missing.join(", ")} in ${audioDir} — run \`video audio <project>\` first`,
    );
  }
  if (files.length === 0) {
    throw new Error(`no usable scene-N.wav files in ${audioDir}`);
  }
  return files;
}

/** Scene numbers from storyboard.yaml, in document order. null when the
 * storyboard is missing or unreadable — the caller then falls back to
 * the directory listing. */
function readStoryboardSceneNumbers(projectRoot: string): number[] | null {
  const storyboardPath = path.join(
    projectRoot,
    "storyboard",
    "storyboard.yaml",
  );
  if (!existsSync(storyboardPath)) return null;
  try {
    const text = readFileSync(storyboardPath, "utf8");
    const doc = parseYaml(text) as { scenes?: Array<{ id?: string }> };
    if (!Array.isArray(doc.scenes)) return null;
    const nums: number[] = [];
    for (const s of doc.scenes) {
      const m = (s?.id ?? "").match(/scene[-_]?(\d+)/);
      if (m) nums.push(parseInt(m[1]!, 10));
    }
    return nums.length > 0 ? nums : null;
  } catch {
    return null;
  }
}

/** Parse `--sfx scene_2=whoosh` flags into a cue map.
 *
 * The scene key goes through the SAME schema mix.yaml uses, so a
 * mis-keyed cue fails loudly here instead of being dropped in silence —
 * `scene-02` (hyphen) is the easy mistake, and it used to cost every
 * cue in the file. */
export function parseSfxFlags(
  flags: string[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const flag of flags ?? []) {
    const eq = flag.indexOf("=");
    if (eq <= 0 || eq === flag.length - 1) {
      throw new Error(
        `--sfx must be scene_N=tag (e.g. scene_2=whoosh), got "${flag}"`,
      );
    }
    const key = flag.slice(0, eq).trim();
    const tag = flag.slice(eq + 1).trim();
    const parsedKey = SfxCueKeySchema.safeParse(key);
    if (!parsedKey.success) {
      throw new Error(
        `--sfx "${flag}": ${parsedKey.error.issues[0]?.message ?? "invalid scene key"}`,
      );
    }
    out[parsedKey.data] = tag;
  }
  return out;
}

/** Validate a cue MAP (already parsed from flags or audio-config.yaml)
 *  through the same SfxCueKeySchema — same loud failure, one rule. */
function validateSfxMap(sfx: Record<string, string>): void {
  for (const key of Object.keys(sfx)) {
    const parsedKey = SfxCueKeySchema.safeParse(key);
    if (!parsedKey.success) {
      throw new Error(
        `sfx cue key "${key}": ${parsedKey.error.issues[0]?.message ?? "invalid scene key"} (expected scene_N, e.g. scene_2)`,
      );
    }
  }
}

/** Parse a spec's SFX cues into engine cues by translating scene_N tags into
 * absolute seconds based on the accumulated narration duration. */
function resolveSfxCues(
  specSfx: Record<string, string> | undefined,
  sfxDir: string,
  narrationPaths: string[],
  narrationDurationsSec: number[],
): { atSec: number; path: string }[] {
  if (!specSfx) return [];
  // Both cue sources (mix.yaml and pre-parsed maps) are validated against
  // SfxCueKeySchema before they get here, so every key matches scene_N and
  // none can be silently skipped.
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
async function probeTotalDuration(narrationPaths: string[]): Promise<number[]> {
  return Promise.all(
    narrationPaths.map(async (p) => {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=duration",
        "-of",
        "csv=p=0",
        p,
      ]);
      const seconds = parseFloat(stdout.trim());
      if (!Number.isFinite(seconds)) {
        throw new Error(`ffprobe could not parse a duration for ${p}`);
      }
      return seconds;
    }),
  );
}

/** The full mix operation behind one interface: narration selection,
 *  BGM resolution (explicit > mix.yaml > library default), SFX cue
 *  placement, ffmpeg mix, run record, and the output-artifact check.
 *  Both `video mix` (CLI) and `video make`'s mix step call this —
 *  in-process, no nested CLI subprocess. */
export async function mixProject(
  projectRoot: string,
  opts: MixProjectOptions = {},
): Promise<MixOutcome> {
  const fail = (error: string, lines: string[] = []): MixOutcome => ({
    ok: false,
    lines,
    warnings: [],
    error,
    outputs: [],
  });

  const warnings: string[] = [];

  let narrationPaths: string[];
  let bgmPath: string;
  try {
    narrationPaths = pickNarrations(projectRoot);
    bgmPath = pickBgm(projectRoot, opts.bgmPath);
  } catch (err) {
    return fail((err as Error).message, [`\u2717 ${(err as Error).message}`]);
  }

  // Read mix.yaml (optional) — overrides BGM selection and may define SFX
  // cues + fade durations. Explicit options override the spec where set.
  const mixYamlPath =
    opts.mixYamlPath ?? path.join(projectRoot, "audio-assets", "mix.yaml");
  let spec = null;
  if (existsSync(mixYamlPath)) {
    try {
      spec = parseMixYaml(readFileSync(mixYamlPath, "utf8"));
    } catch (err) {
      return fail((err as Error).message, [`\u2717 ${(err as Error).message}`]);
    }
    if (opts.bgmPath === undefined && spec.bgm) {
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
        warnings.push(
          `mix.yaml bgm "${spec.bgm}" not found at ${specBgm} — falling back to ${path.basename(bgmPath)}`,
        );
      }
    }
  }

  const fadeIn = opts.bgmFadeInSec ?? spec?.bgm_fade_in_sec ?? 0;
  const fadeOut = opts.bgmFadeOutSec ?? spec?.bgm_fade_out_sec ?? 0;
  const sfxDir = path.join(projectRoot, "assets/audio-assets/sfx");
  // Cues from a pre-parsed map (audio-config.yaml via `video make`, or
  // --sfx flags via the CLI) and from mix.yaml are merged; the map wins
  // on the same scene key.
  let sfxSpec: Record<string, string>;
  try {
    if (opts.sfx !== undefined) validateSfxMap(opts.sfx);
    sfxSpec = { ...(spec?.sfx ?? {}), ...(opts.sfx ?? {}) };
  } catch (err) {
    return fail((err as Error).message, [`✗ ${(err as Error).message}`]);
  }
  let sfxCues: { atSec: number; path: string }[];
  try {
    // Durations are only needed to place SFX cues — probe (and fail loudly
    // on error) only when the spec actually defines cues.
    const narrationDurationsSec =
      Object.keys(sfxSpec).length > 0
        ? await probeTotalDuration(narrationPaths)
        : [];
    sfxCues = resolveSfxCues(
      sfxSpec,
      sfxDir,
      narrationPaths,
      narrationDurationsSec,
    );
  } catch (err) {
    return fail((err as Error).message, [`✗ ${(err as Error).message}`]);
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
    return fail((err as Error).message, [
      `\u2717 audio mix failed: ${(err as Error).message}`,
    ]);
  }

  // `video mix` used to exit 0 even when it wrote nothing useful elsewhere
  // in its history — verify the artifact instead of asserting by convention.
  if (!existsSync(outPath)) {
    return fail("mix reported success but output/final-mixed.mp4 is missing");
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
  await writeRun(projectRoot, {
    run_id: runId,
    stage: "audio-mix",
    status: "succeeded",
    actor: "tool",
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
  });

  return {
    ok: true,
    lines: [
      `\u2713 mixed ${path.basename(projectRoot)}/output/final-mixed.mp4`,
      `  narration=${narrationPaths.length} files  bgm=${path.basename(bgmPath)}  sfx=${sfxCues.length} cues  fade=${fadeIn}s/${fadeOut}s`,
      `  next: this is the audio you ship`,
    ],
    warnings,
    error: "",
    outputs: ["output/final-mixed.mp4"],
  };
}
