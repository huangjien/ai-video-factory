import { execFile } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface MixOptions {
  narrationPaths: string[];
  bgmPath: string;
  outPath: string;
  /**
   * When set, mux this file's video stream into `outPath` via
   * `-c:v copy`. Its audio is ignored — `outPath`'s audio is the
   * mixed narrative + BGM. Undefined = audio-only output.
   */
  videoPath?: string;
  bgmAttenuationDb?: number;
  /**
   * Sidechain ducking gate in dBFS: narration below this level ducks the
   * BGM. Converted to the linear amplitude that ffmpeg's sidechaincompress
   * `threshold` option expects — earlier versions passed the raw number
   * through unconverted, so the old 0.05 default only worked by accident
   * (0.05 is a sane *linear* value). Default -26 dB ≡ linear 0.05.
   */
  duckerThresholdDb?: number;
}

export interface SfxCue {
  atSec: number;
  path: string;
}

export interface MixWithSpecOptions extends MixOptions {
  sfxCues?: SfxCue[];
  bgmFadeInSec?: number;
  bgmFadeOutSec?: number;
}

export interface MixResult {
  outPath: string;
}

/**
 * Mix per-scene narration WAVs with a single BGM track into one container.
 *
 * Approach:
 *   1) Concatenate all narrations into one WAV via the ffmpeg `concat`
 *      demuxer driven by a pre-written list-file (the pipe-separated
 *      "file a|file b" syntax doesn't work in ffmpeg 9.x — it treats the
 *      whole thing as one input path).
 *   2) Mix that concatenated narration with the BGM using `amix` plus a
 *      `sidechaincompress` keyed off the narration — the BGM is
 *      pre-attenuated ~-18 dB and ducks further whenever narration is
 *      speaking. Soundscape stays audible between lines; voice stays on top.
 *
 * v0.3.4 ships BGM-only mixing. SFX cueing requires a scene-to-cue mapping
 * convention (deferred).
 */
export async function mixTracks(opts: MixOptions): Promise<MixResult> {
  if (opts.narrationPaths.length === 0) {
    throw new Error("at least one narration path is required");
  }
  await mkdir(path.dirname(opts.outPath), { recursive: true });
  const bgmAttenuationDb = opts.bgmAttenuationDb ?? -18;
  const duckerThresholdDb =
    opts.duckerThresholdDb ?? DEFAULT_DUCKER_THRESHOLD_DB;
  const bgmLinear = dbToLinear(bgmAttenuationDb);
  const duckerThresholdLinear = dbToLinear(duckerThresholdDb);

  const tmpDir = await mkdtemp(path.join(path.dirname(opts.outPath), ".mix-"));
  const listFile = path.join(tmpDir, "list.txt");
  const tmpNarration = path.join(tmpDir, "narration.wav");
  await writeFile(
    listFile,
    opts.narrationPaths
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join("\n"),
    "utf8",
  );
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-ar",
    "44100",
    "-ac",
    "1",
    tmpNarration,
  ]);

  const filter = buildMixFilterGraph({
    bgmLinear,
    duckerThreshold: duckerThresholdLinear,
  });
  const inputArgs: string[] = ["-i", tmpNarration, "-i", opts.bgmPath];
  let videoIndex: number | null = null;
  if (opts.videoPath && existsSync(opts.videoPath)) {
    videoIndex = 2; // narration=0, bgm=1, video=2
    inputArgs.push("-i", opts.videoPath);
  }
  const mapArgs: string[] = ["-map", "[out]"];
  const codecArgs: string[] = ["-c:a", "aac", "-b:a", "192k"];
  if (videoIndex !== null) {
    mapArgs.push("-map", `${videoIndex}:v`, "-c:v", "copy");
  }
  mapArgs.push(
    "-movflags",
    "+faststart",
    opts.outPath,
  );
  await execFileAsync(
    "ffmpeg",
    ["-y", ...inputArgs, "-filter_complex", filter, ...mapArgs, ...codecArgs],
  );
  await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  return { outPath: opts.outPath };
}

/**
 * Default BGM-ducking gate in dBFS. 20·log10(0.05) ≈ -26 — reproduces the
 * pre-fix default, which sidechaincompress only accepted because 0.05 is
 * already a sane *linear* amplitude.
 */
export const DEFAULT_DUCKER_THRESHOLD_DB = -26;

/** Convert dBFS to the linear amplitude ffmpeg's `volume` and
 * sidechaincompress `threshold` options expect. */
export function dbToLinear(db: number): string {
  return String(Math.pow(10, db / 20));
}

/**
 * Full filter graph for the basic `mixTracks`. `normalize=0` is required:
 * ffmpeg's amix scales every input to 1/n by default, dropping the
 * narration 6 dB in a 2-input mix — and with dropout_transition=0 the
 * narration gain snaps back to 1.0 the moment the BGM stream ends, an
 * audible jump mid-video.
 */
export function buildMixFilterGraph(opts: {
  bgmLinear: string;
  duckerThreshold: string;
}): string {
  return [
    "[0:a]aresample=44100[nar]",
    `[1:a]aresample=44100,volume=${opts.bgmLinear}[bgm_pre]`,
    `[bgm_pre][nar]sidechaincompress=threshold=${opts.duckerThreshold}:ratio=8:attack=5:release=400[bgm]`,
    // Use [0:a] (original narration) for the final amix, not [nar]
    // (the resampled narration). ffmpeg 6.x has a parser bug that rejects
    // reusing the same label as BOTH a sidechain input AND an amix input
    // in the same graph — the parser reports "Invalid stream specifier"
    // and "matches no streams" for [nar] even though it's clearly defined
    // earlier. Using [0:a] for the final mix sidesteps the bug; the audio
    // is semantically equivalent (amix doesn't care about the 44.1kHz
    // resample that sidechaincompress needs).
    "[0:a][bgm]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[out]",
  ].join(";");
}

/**
 * BGM-side segments for `mixTracksWithSpec`: resample, attenuate, pad to
 * the narration length, then duck under the narration sidechain. `apad
 * whole_dur` pads with silence up to a total length and never truncates,
 * so a BGM shorter than the narration still spans the whole video —
 * without it an afade timestamp computed as (narration length − fadeOut)
 * falls past a short BGM's end and the fade silently never fires.
 */
export function buildBgmSegments(opts: {
  bgmLinear: string;
  duckerThreshold: string;
  narrationDurationSec: number;
}): string[] {
  return [
    `[1:a]aresample=44100,volume=${opts.bgmLinear},apad=whole_dur=${opts.narrationDurationSec}[bgm_pre]`,
    `[bgm_pre][nar]sidechaincompress=threshold=${opts.duckerThreshold}:ratio=8:attack=5:release=400[bgm]`,
  ];
}

export interface BgmFadeChain {
  segments: string[];
  outputLabel: string;
}

/**
 * Optional afade envelope for the ducked BGM. Fade timestamps are computed
 * against the narration length — safe only because `buildBgmSegments`
 * pads the BGM to that length. Each afade gets its own output label
 * because a filter node can't feed the same stream twice.
 */
export function buildBgmFadeChain(opts: {
  narrationDurationSec: number;
  fadeInSec: number;
  fadeOutSec: number;
}): BgmFadeChain {
  const segments: string[] = [];
  let label = "bgm";
  if (opts.fadeInSec > 0) {
    segments.push(`[bgm]afade=in:st=0:d=${opts.fadeInSec}[bgm_fi]`);
    label = "bgm_fi";
  }
  if (opts.fadeOutSec > 0) {
    const fadeOutStart = Math.max(
      0,
      opts.narrationDurationSec - opts.fadeOutSec,
    );
    segments.push(
      `[${label}]afade=out:st=${fadeOutStart}:d=${opts.fadeOutSec}[bgm_fo]`,
    );
    label = "bgm_fo";
  }
  return { segments, outputLabel: label };
}

/**
 * Two-pass mixer: the basic `mixTracks` (BGM over narration) extended with
 * optional SFX cues placed at exact timestamps and optional BGM fade-in/
 * fade-out. The engine builds a single ffmpeg filter graph:
 *   1. concat narrations
 *   2. lay SFX cues on top of the narration timeline (amix with delays)
 *   3. lay BGM under both with sidechain compression (BGM ducks under
 *      narration) and optional afade envelope
 *   4. amix the three layers into one output
 */
export async function mixTracksWithSpec(
  opts: MixWithSpecOptions,
): Promise<MixResult> {
  if (opts.narrationPaths.length === 0) {
    throw new Error("at least one narration path is required");
  }
  for (const cue of opts.sfxCues ?? []) {
    if (cue.atSec < 0) {
      throw new Error(`SFX cue atSec must be >= 0 (got ${cue.atSec})`);
    }
    if (!existsSync(cue.path)) {
      throw new Error(`SFX cue file not found: ${cue.path}`);
    }
  }
  await mkdir(path.dirname(opts.outPath), { recursive: true });
  const bgmAttenuationDb = opts.bgmAttenuationDb ?? -18;
  const duckerThresholdDb =
    opts.duckerThresholdDb ?? DEFAULT_DUCKER_THRESHOLD_DB;
  const bgmLinear = dbToLinear(bgmAttenuationDb);
  const duckerThresholdLinear = dbToLinear(duckerThresholdDb);
  const fadeIn = Math.max(0, opts.bgmFadeInSec ?? 0);
  const fadeOut = Math.max(0, opts.bgmFadeOutSec ?? 0);

  // Step 1: concatenate narrations.
  const tmpDir = await mkdtemp(path.join(path.dirname(opts.outPath), ".mix-"));
  const listFile = path.join(tmpDir, "list.txt");
  const tmpNarration = path.join(tmpDir, "narration.wav");
  await writeFile(
    listFile,
    opts.narrationPaths
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join("\n"),
    "utf8",
  );
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-ar",
    "44100",
    "-ac",
    "1",
    tmpNarration,
  ]);
  // Probe concatenated narration duration so we can place the fade-out
  // at a concrete timestamp (afade=out:st=N requires an absolute second,
  // not the symbolic "END-N").
  const narrationDuration = parseFloat(
    execFileSync(
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
        tmpNarration,
      ],
      { encoding: "utf8" },
    ).trim(),
  );

  // Step 2: build the combined filter graph.
  //   [0:a]aresample=44100[nar]
  //   [1:a]aresample=44100,volume=<bgm>,apad=whole_dur=<narration>[bgm_pre]
  //   [bgm_pre][nar]sidechaincompress=...[bgm]               ; duck under narration
  //   [bgm]afade=...[bgm_faded]                              ; optional fade envelope
  //   <each SFX input>[sfx_n]                                 ; one filter per cue
  //   [sfx_0][sfx_1]...[nar][bgm_faded][sfx_merged]amix=...[out]
  //
  // Label `nar` instead of `n` (cosmetic; not a workaround for any ffmpeg
  // build bug — the parser accepts both). Kept multi-char for readability.
  const bgmFade = buildBgmFadeChain({
    narrationDurationSec: narrationDuration,
    fadeInSec: fadeIn,
    fadeOutSec: fadeOut,
  });
  const filterParts: string[] = [
    "[0:a]aresample=44100[nar]",
    ...buildBgmSegments({
      bgmLinear,
      duckerThreshold: duckerThresholdLinear,
      narrationDurationSec: narrationDuration,
    }),
    ...bgmFade.segments,
  ];
  const bgmLabel = bgmFade.outputLabel;
  const inputs: string[] = [tmpNarration, opts.bgmPath];
  const sfxMergeLabels: string[] = [];
  for (let i = 0; i < (opts.sfxCues ?? []).length; i++) {
    const cue = (opts.sfxCues ?? [])[i]!;
    inputs.push(cue.path);
    const idx = inputs.length - 1;
    const label = `sfx_${i}`;
    filterParts.push(
      `[${idx}:a]aresample=44100,adelay=${Math.round(cue.atSec * 1000)}|${Math.round(cue.atSec * 1000)}[${label}]`,
    );
    sfxMergeLabels.push(`[${label}]`);
  }
  let videoIndex: number | null = null;
  if (opts.videoPath && existsSync(opts.videoPath)) {
    videoIndex = inputs.length;
    inputs.push(opts.videoPath);
  }
  // Use [0:a] (original narration) for the final amix, not [nar]
  // (the resampled narration). ffmpeg 6.x has a parser bug that rejects
  // reusing the same label as BOTH a sidechain input AND an amix input
  // in the same graph; using [0:a] sidesteps it. See
  // buildMixFilterGraph() for the full explanation.
  const mixInputs = ["[0:a]", `[${bgmLabel}]`, ...sfxMergeLabels].join("");
  const mixFilter = `${mixInputs}amix=inputs=${2 + sfxMergeLabels.length}:duration=longest:dropout_transition=0:normalize=0[out]`;
  filterParts.push(mixFilter);

  const mapArgs: string[] = ["-map", "[out]"];
  const codecArgs: string[] = ["-c:a", "aac", "-b:a", "192k"];
  if (videoIndex !== null) {
    mapArgs.push("-map", `${videoIndex}:v`, "-c:v", "copy");
  }
  mapArgs.push("-movflags", "+faststart", opts.outPath);

  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      ...inputs.flatMap((p) => ["-i", p]),
      "-filter_complex",
      filterParts.join(";"),
      ...mapArgs,
      ...codecArgs,
    ],
  );
  await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  return { outPath: opts.outPath };
}
