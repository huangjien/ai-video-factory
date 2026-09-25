import { execFile } from "node:child_process";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { parseArticle, type ParsedArticle } from "@vf/draft";
import { parse as parseYaml } from "yaml";
import {
  FakeTTSProvider,
  EdgeTTSProvider,
  type TTSProvider,
} from "@vf/tts";
import { MockAudioAssetProvider } from "@vf/audio-assets";

const execFileAsync = promisify(execFile);

export interface MakeOptions {
  projectRoot: string;
  /** Use offline fake provider (no Edge-TTS network call). */
  fake?: boolean;
  /** Skip steps whose outputs are newer than their inputs. Default true. */
  idempotent?: boolean;
  /** If true, log what would be done without executing. */
  dryRun?: boolean;
}

export interface MakeStep {
  name: string;
  status: "skip" | "would-run" | "ran" | "fail";
  message?: string;
  outputs?: string[];
}

export interface MakeReport {
  steps: MakeStep[];
  outputFiles: string[];
}

// Default: male narration voices. Female alternatives: zh-CN-XiaoxiaoNeural,
// en-US-AriaNeural.
const ZH_VOICE = "zh-CN-YunjianNeural";
const EN_VOICE = "en-US-ChristopherNeural";

/** Run the make pipeline against an article.md + audio-config.yaml project. */
export async function runMake(opts: MakeOptions): Promise<MakeReport> {
  const idempotent = opts.idempotent !== false;
  const dryRun = opts.dryRun === true;
  const report: MakeReport = { steps: [], outputFiles: [] };

  // 0. Inputs must exist.
  const articlePath = path.join(opts.projectRoot, "article.md");
  const audioConfigPath = path.join(opts.projectRoot, "audio-config.yaml");
  if (!existsSync(articlePath)) {
    failStep(report, "inputs", `article.md not found at ${articlePath}`);
    return report;
  }
  if (!existsSync(audioConfigPath)) {
    failStep(report, "inputs", `audio-config.yaml not found at ${audioConfigPath}`);
    return report;
  }

  const articleMd = await readFile(articlePath, "utf8");
  const article = parseArticle(articleMd);
  const audioConfig = parseYaml(
    await readFile(audioConfigPath, "utf8"),
  ) as AudioConfigShape;

  // 1. TTS scenes — narrate each scene's voice-over text.
  await runStep(report, "tts", idempotent, dryRun, () =>
    runTts(opts.projectRoot, article, audioConfig, {
      fake: opts.fake === true,
    }),
  );

  // 1b. Resync storyboard.yaml durations to actual TTS lengths.
  await runStep(report, "sync-durations", idempotent, dryRun, () =>
    syncStoryboardDurations(opts.projectRoot),
  );

  // 2. Materialize declared BGM/SFX assets.
  await runStep(report, "audio-assets", idempotent, dryRun, () =>
    runAudioAssets(opts.projectRoot, audioConfig),
  );

  // 3. Render preview (compile article → VDSL → mp4).
  await runStep(report, "render-preview", idempotent, dryRun, () =>
    runRenderPreview(opts.projectRoot, article),
  );

  // 4. Mix narration + BGM + SFX cues.
  await runStep(report, "mix", idempotent, dryRun, () =>
    runMix(opts.projectRoot, audioConfig),
  );

  // Collect outputs.
  report.outputFiles = await collectOutputs(opts.projectRoot);

  return report;
}

async function runStep(
  report: MakeReport,
  name: string,
  idempotent: boolean,
  dryRun: boolean,
  run: () => Promise<string[]>,
): Promise<void> {
  if (dryRun) {
    report.steps.push({ name, status: "would-run" });
    return;
  }
  try {
    const outputs = await run();
    report.steps.push({ name, status: "ran", outputs });
  } catch (err) {
    report.steps.push({
      name,
      status: "fail",
      message: (err as Error).message,
    });
    throw err;
  }
}

function failStep(report: MakeReport, name: string, message: string): void {
  report.steps.push({ name, status: "fail", message });
}

interface AudioConfigShape {
  voice?: string;
  bgm?: string | null;
  bgm_fade_in_sec?: number;
  bgm_fade_out_sec?: number;
  pause_between_sentences_sec?: number;
  sfx?: Record<string, string>;
}

/**
 * Probe each scene's TTS WAV and rewrite storyboard.yaml so its
 * `duration:` field matches actual audio length. Without this, the
 * renderer's frame count comes from the LLM-estimated duration in
 * article.md — which the LLM consistently underestimates — so the
 * video freezes at the planned length while the audio continues.
 *
 * Regex-based line replacement rather than yaml round-trip: that
 * would lose comments and reformat the file.
 */
async function syncStoryboardDurations(projectRoot: string): Promise<string[]> {
  const audioDir = path.join(projectRoot, "assets", "audio");
  const storyboardPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
  if (!existsSync(audioDir) || !existsSync(storyboardPath)) return [];

  const wavs = (await readdir(audioDir))
    .filter((f) => /^scene[-_]?(\d+)\.wav$/.test(f))
    .sort();
  if (wavs.length === 0) return [];

  const durations = new Map<string, number>();
  for (const w of wavs) {
    const m = w.match(/^scene[-_]?(\d+)\.wav$/);
    if (!m) continue;
    // Storyboard IDs are zero-padded (scene-01, scene-02 …). Keep the
    // captured string verbatim so the lookup matches the YAML id line.
    const idKey = m[1]!;
    try {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=duration",
        "-of",
        "csv=p=0",
        path.join(audioDir, w),
      ]);
      const sec = parseFloat(stdout.trim());
      if (Number.isFinite(sec) && sec > 0) {
        durations.set(idKey, sec);
      }
    } catch {
      // ignore unprobeable files
    }
  }
  if (durations.size === 0) return [];

  const yaml = await readFile(storyboardPath, "utf8");
  const lines = yaml.split("\n");
  const outputs: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const idMatch = lines[i]!.match(/^\s*-\s*id:\s*scene[-_]?(\d+)\s*$/);
    if (!idMatch) continue;
    // YAML ids are zero-padded (scene-01, scene-02 …); wav filenames
    // are not. parseInt collapses both to the integer key the Map uses.
    const sceneKey = String(parseInt(idMatch[1]!, 10));
    const measured = durations.get(sceneKey);
    if (measured === undefined) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
      const durMatch = lines[j]!.match(/^(\s*)duration:\s*\d+(?:\.\d+)?\s*$/);
      if (durMatch) {
        const newSec = measured.toFixed(2);
        lines[j] = `${durMatch[1]}duration: ${newSec}`;
        outputs.push(`storyboard.yaml: scene_${sceneKey} duration=${newSec}s`);
        break;
      }
    }
  }
  await writeFile(storyboardPath, lines.join("\n"), "utf8");
  return outputs;
}

async function runTts(
  projectRoot: string,
  article: ParsedArticle,
  audioConfig: AudioConfigShape,
  opts: { fake?: boolean },
): Promise<string[]> {
  const provider: TTSProvider = opts.fake
    ? new FakeTTSProvider({ sampleBytes: 256 })
    : new EdgeTTSProvider();
  const voice =
    article.frontmatter.voice ||
    (article.frontmatter.language === "en-US" ? EN_VOICE : ZH_VOICE);
  const audioDir = path.join(projectRoot, "assets", "audio");
  await mkdir(audioDir, { recursive: true });

  const outputs: string[] = [];
  for (const scene of article.scenes) {
    const wavPath = path.join(audioDir, `${scene.id}.wav`);
    if (existsSync(wavPath)) {
      // Skip — narration already produced.
      continue;
    }
    const result = await provider.synthesize({
      text: scene.narration,
      voice,
      language: article.frontmatter.language,
      ...(typeof audioConfig.pause_between_sentences_sec === "number"
        ? { pauseBetweenSentencesSec: audioConfig.pause_between_sentences_sec }
        : {}),
    });
    // Same WAV/MP3 detection as @vf/cli runAudio.
    const isWav =
      result.audio.length >= 12 &&
      result.audio[0] === 0x52 &&
      result.audio[1] === 0x49 &&
      result.audio[2] === 0x46 &&
      result.audio[3] === 0x46;
    const wavBytes = isWav
      ? result.audio
      : await mp3ToWav(result.audio, scene.duration);
    await writeFile(wavPath, wavBytes);
    outputs.push(`assets/audio/${scene.id}.wav`);
  }

  // Write a minimal captions SRT.
  const srtPath = path.join(
    projectRoot,
    "captions",
    `${article.frontmatter.language}.srt`,
  );
  await mkdir(path.dirname(srtPath), { recursive: true });
  const scenes = article.scenes;
  const cues = scenes
    .map((s, i) => {
      const start = scenes.slice(0, i).reduce((acc, x) => acc + x.duration, 0);
      const end = start + s.duration;
      return `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${s.narration}\n`;
    })
    .join("\n");
  await writeFile(srtPath, cues, "utf8");
  outputs.push(`captions/${article.frontmatter.language}.srt`);

  return outputs;
}

function formatSrtTime(sec: number): string {
  const h = Math.floor(sec / 3600).toString().padStart(2, "0");
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  const ms = Math.round((sec - Math.floor(sec)) * 1000).toString().padStart(3, "0");
  return `${h}:${m}:${s},${ms}`;
}

async function runAudioAssets(
  projectRoot: string,
  config: AudioConfigShape,
): Promise<string[]> {
  const provider = new MockAudioAssetProvider();
  const outputs: string[] = [];
  const assetsDir = path.join(projectRoot, "assets", "audio-assets");
  await mkdir(path.join(assetsDir, "bgm"), { recursive: true });
  await mkdir(path.join(assetsDir, "sfx"), { recursive: true });

  if (config.bgm && typeof config.bgm === "string") {
    const out = path.join(assetsDir, "bgm", `${config.bgm}.wav`);
    if (!existsSync(out)) {
      const r = await provider.pickBackgroundMusic({ tag: config.bgm });
      await writeFile(out, r.bytes);
      outputs.push(`assets/audio-assets/bgm/${config.bgm}.wav`);
    }
  }
  const sfx = config.sfx ?? {};
  for (const [sceneId, tag] of Object.entries(sfx)) {
    const out = path.join(assetsDir, "sfx", `${tag}.wav`);
    if (!existsSync(out)) {
      const r = await provider.pickSoundEffect({ tag });
      await writeFile(out, r.bytes);
      outputs.push(`assets/audio-assets/sfx/${tag}.wav`);
    }
  }
  return outputs;
}

async function runRenderPreview(
  projectRoot: string,
  article: ParsedArticle,
): Promise<string[]> {
  // For v1 we shell out to the existing render path; a future revision
  // will compile article.md scenes directly to VDSL without going via
  // storyboard.yaml.
  const slug = article.frontmatter.project;
  const workspaceRoot = path.dirname(path.dirname(projectRoot));
  await runCli(
    [
      "node",
      "packages/cli/dist/index.js",
      "preview",
      "--cwd",
      `projects/${slug}`,
    ],
    { cwd: workspaceRoot },
  );
  // Mirror what `vf preview` actually writes.
  return ["output/preview.mp4", "output/preview-faststart.mp4"];
}

async function runMix(
  projectRoot: string,
  config: AudioConfigShape,
): Promise<string[]> {
  const slug = path.basename(projectRoot);
  const workspaceRoot = path.dirname(path.dirname(projectRoot));
  // Translate audio-config.yaml → vf mix CLI flags rather than
  // duplicating the existing pipeline.
  const mixArgs: string[] = [
    "node",
    "packages/cli/dist/index.js",
    "mix",
    slug,
  ];
  if (config.bgm) {
    const bgmAbs = path.join(projectRoot, "assets", "audio-assets", "bgm", `${config.bgm}.wav`);
    mixArgs.push("--bgm", bgmAbs);
  }
  if (typeof config.bgm_fade_in_sec === "number") {
    mixArgs.push("--bgm-fade-in", String(config.bgm_fade_in_sec));
  }
  if (typeof config.bgm_fade_out_sec === "number") {
    mixArgs.push("--bgm-fade-out", String(config.bgm_fade_out_sec));
  }
  await runCli(mixArgs, { cwd: workspaceRoot });
  // Mirror what `vf mix` actually writes.
  return ["output/final-mixed.mp4"];
}

async function runCli(
  args: string[],
  opts: { cwd: string },
): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(args[0] ?? "node", args.slice(1), {
      cwd: opts.cwd,
      stdio: "inherit",
    });
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${args.join(" ")} exited with code ${code}`)),
    );
    proc.on("error", reject);
  });
}

async function collectOutputs(projectRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const dir of ["assets/audio", "captions", "assets/audio-assets", "output"]) {
    const fullDir = path.join(projectRoot, dir);
    if (!existsSync(fullDir)) continue;
    // Shallow listing only — full recursive scan adds noise to the report.
    try {
      const entries = await readFile(path.join(fullDir, ".placeholder"), "utf8").catch(() => "");
      if (entries) out.push(`${dir}/<contents>`);
    } catch {
      // ignore
    }
  }
  return out;
}

function slugify(s: string): string {
  return (
    s
      ?.toLowerCase()
      ?.replace(/[^a-z0-9]+/g, "-")
      ?.replace(/^-|-$/g, "") ?? ""
  );
}

/** Same mp3ToWav helper as @vf/cli runAudio — kept local to avoid a
 * circular import from the CLI package. */
async function mp3ToWav(
  mp3Bytes: Uint8Array,
  targetDurationSec: number,
): Promise<Uint8Array> {
  const dir = await (await import("node:fs/promises")).mkdtemp(
    path.join(os.tmpdir(), "vf-make-tts-"),
  );
  try {
    const inPath = path.join(dir, "in.mp3");
    const outPath = path.join(dir, "out.wav");
    await writeFile(inPath, mp3Bytes);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inPath,
      "-ar",
      "44100",
      "-ac",
      "1",
      "-af",
      `apad,atrim=0:${targetDurationSec}`,
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await (await import("node:fs/promises")).rm(dir, {
      recursive: true,
      force: true,
    });
  }
}

export { MockAudioAssetProvider };
