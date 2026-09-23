import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { mixTracks, mixTracksWithSpec, parseMixYaml } from "@vf/audio-mix";
import { formatRunId } from "@vf/workflow";

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

function pickBgm(projectRoot: string, explicit?: string): string {
  if (explicit) return explicit;
  const bgmDir = path.join(projectRoot, "assets", "audio-assets", "bgm");
  if (!existsSync(bgmDir)) {
    throw new Error(
      `no BGM found: pass --bgm <path> or run \`vf audio-asset --bgm <tag>\` first`,
    );
  }
  const candidates = readdirSync(bgmDir)
    .filter((f) => f.toLowerCase().endsWith(".wav"))
    .map((f) => path.join(bgmDir, f))
    .sort();
  if (candidates.length === 0) {
    throw new Error(`no .wav files in ${bgmDir}`);
  }
  return candidates[0] ?? "";
}

function pickNarrations(projectRoot: string): string[] {
  const audioDir = path.join(projectRoot, "assets", "audio");
  if (!existsSync(audioDir)) {
    throw new Error(
      `no narration audio in ${audioDir} — run \`vf audio <project>\` first`,
    );
  }
  const files = readdirSync(audioDir)
    .filter((f) => /^scene-\d+\.wav$/.test(f))
    .sort()
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
          `SFX cue "${tag}" for ${sceneKey} not found at ${tagFile} — run \`vf audio-asset --sfx ${tag}\` first`,
        );
      }
      cues.push({ atSec: cumulative, path: tagFile });
    }
    cumulative += narrationDurationsSec[i] ?? 0;
  }
  return cues;
}

/** Probe concatenated-narration duration so we can place the fade-out and
 * SFX cues at concrete timestamps. */
function probeTotalDuration(narrationPaths: string[]): number[] {
  return narrationPaths.map((p) => {
    try {
      return parseFloat(
        execSync(
          `ffprobe -v error -select_streams a:0 -show_entries stream=duration -of csv=p=0 ${JSON.stringify(p)}`,
          { encoding: "utf8" },
        ).trim(),
      );
    } catch {
      return 0;
    }
  });
}

export async function runMix(opts: MixOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const projectRoot = path.join(cwd, "projects", opts.project);
  if (!existsSync(projectRoot)) {
    console.error(`project not found: ${projectRoot}`);
    return 1;
  }
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
      try {
        bgmPath = pickBgm(
          projectRoot,
          `${projectRoot}/assets/audio-assets/bgm/${spec.bgm}.wav`,
        );
      } catch {
        // ignore — fall back to flag/default
      }
    }
  }

  const fadeIn = opts.bgmFadeInSec ?? spec?.bgm_fade_in_sec ?? 0;
  const fadeOut = opts.bgmFadeOutSec ?? spec?.bgm_fade_out_sec ?? 0;
  const sfxDir = path.join(projectRoot, "assets/audio-assets/sfx");
  let sfxCues: { atSec: number; path: string }[];
  try {
    const narrationDurationsSec = probeTotalDuration(narrationPaths);
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

  try {
    if (sfxCues.length > 0 || fadeIn > 0 || fadeOut > 0) {
      await mixTracksWithSpec({
        narrationPaths,
        bgmPath,
        outPath,
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
  const { writeRun } = await import("@vf/workflow");
  await writeRun(projectRoot, record);

  console.log(`\u2713 mixed ${opts.project}/output/final-mixed.mp4`);
  console.log(
    `  narration=${narrationPaths.length} files  bgm=${path.basename(bgmPath)}  sfx=${sfxCues.length} cues  fade=${fadeIn}s/${fadeOut}s`,
  );
  console.log(
    `  next: this is the audio you ship — replaces per-scene narration TTS as the final mix`,
  );
  return 0;
}
