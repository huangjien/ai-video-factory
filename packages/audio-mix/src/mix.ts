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
  const duckerThresholdDb = opts.duckerThresholdDb ?? 0.05;
  const bgmLinear = dbToLinear(bgmAttenuationDb);

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

  const filter = [
    "[0:a]aresample=44100[nar]",
    `[1:a]aresample=44100,volume=${bgmLinear}[bgm_pre]`,
    `[bgm_pre][nar]sidechaincompress=threshold=${duckerThresholdDb}:ratio=8:attack=5:release=400[bgm]`,
    // Use [0:a] (original narration) for the final amix, not [nar]
    // (the resampled narration). ffmpeg 6.x has a parser bug that rejects
    // reusing the same label as BOTH a sidechain input AND an amix input
    // in the same graph — the parser reports "Invalid stream specifier"
    // and "matches no streams" for [nar] even though it's clearly defined
    // earlier. Using [0:a] for the final mix sidesteps the bug; the audio
    // is semantically equivalent (amix doesn't care about the 44.1kHz
    // resample that sidechaincompress needs).
    "[0:a][bgm]amix=inputs=2:duration=longest:dropout_transition=0[out]",
  ].join(";");
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

function dbToLinear(db: number): string {
  return String(Math.pow(10, db / 20));
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
  const duckerThresholdDb = opts.duckerThresholdDb ?? 0.05;
  const bgmLinear = dbToLinear(bgmAttenuationDb);
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
  //   [1:a]aresample=44100,volume=<bgm>[bgm_pre]
  //   [bgm_pre][nar]sidechaincompress=...[bgm]               ; duck under narration
  //   [bgm]afade=...[bgm_faded]                              ; optional fade envelope
  //   <each SFX input>[sfx_n]                                 ; one filter per cue
  //   [sfx_0][sfx_1]...[nar][bgm_faded][sfx_merged]amix=...[out]
  //
  // Label `nar` instead of `n` (cosmetic; not a workaround for any ffmpeg
  // build bug — the parser accepts both). Kept multi-char for readability.
  const filterParts: string[] = [
    "[0:a]aresample=44100[nar]",
    `[1:a]aresample=44100,volume=${bgmLinear}[bgm_pre]`,
    `[bgm_pre][nar]sidechaincompress=threshold=${duckerThresholdDb}:ratio=8:attack=5:release=400[bgm]`,
  ];
  let bgmLabel = "bgm";
  if (fadeIn > 0 || fadeOut > 0) {
    // Chain afade filters — fade-in first, then fade-out at
    // (duration - fadeOut) seconds. Each filter has its own output label
    // because afade can't be re-applied to the same node.
    let chain = "[bgm]";
    if (fadeIn > 0) {
      chain += `afade=in:st=0:d=${fadeIn}[bgm_fi]`;
      chain += `;[bgm_fi]`;
    }
    if (fadeOut > 0) {
      const fadeOutStart = Math.max(0, narrationDuration - fadeOut);
      chain += `afade=out:st=${fadeOutStart}:d=${fadeOut}[bgm_fo]`;
      bgmLabel = "bgm_fo";
    } else {
      bgmLabel = fadeIn > 0 ? "bgm_fi" : "bgm";
    }
    filterParts.push(chain);
  }
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
  // in the same graph; using [0:a] sidesteps it. See mixTracks() for
  // the full explanation.
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
