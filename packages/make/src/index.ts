import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  stat,
} from "node:fs/promises";
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { parseArticleWithRecovery, articleToStoryboardYaml, expandScenePrompt, type ParsedArticle } from "@video/draft";
import { MiniMaxProvider } from "@video/llm";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import {
  FakeTTSProvider,
  EdgeTTSProvider,
  type TTSProvider,
} from "@video/tts";
import { readSceneTimings, syncSceneDurations, probeAudioDuration } from "@video/media";
import {
  planBgmWindows,
  renderBgmTimeline,
} from "@video/audio-mix";
import {
  FileBasedAudioAssetProvider,
  MiniMaxMusicProvider,
  MockAudioAssetProvider,
  type AudioAssetProvider,
} from "@video/audio-assets";
import {
  MiniMaxImageProvider,
  MockImageProvider,
  type ImageProvider,
} from "@video/media-generators";

const execFileAsync = promisify(execFile);

export interface MakeOptions {
  projectRoot: string;
  /** Use offline fake provider (no Edge-TTS network call). */
  fake?: boolean;
  /** Skip steps whose outputs are newer than their inputs. Default true. */
  idempotent?: boolean;
  /** If true, log what would be done without executing. */
  dryRun?: boolean;
  /** Image provider for scene visuals: "minimax" (real AI), "mock"
   * (deterministic placeholder), or "none" (skip image generation;
   * scenes fall back to AnimatedIllustration geometric shapes). */
  imageProvider?: "minimax" | "mock" | "none";
  /** Local music library for real BGM — a directory containing
   * `{tag}.wav` (or any .wav whose name contains the tag). Without it
   * the audio-assets step writes a mock silent placeholder. */
  bgmDir?: string;
  /** Local SFX library, same lookup rule as bgmDir. */
  sfxDir?: string;
  /** BGM generation backend: "auto" (default) uses MiniMax music
   * generation when MINIMAX_API_KEY is set, else silent mock. */
  musicProvider?: "auto" | "minimax" | "mock";
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
  let article;
  try {
    const parsed = parseArticleWithRecovery(articleMd);
    article = parsed.article;
    if (parsed.recoveredCount > 0) {
      report.steps.push({
        name: "recover-narrations",
        status: "ran",
        message:
          `article.md had ${parsed.recoveredCount} empty scene narrations — ` +
          `back-filled from ## section bodies (LLM draft was malformed)`,
      });
    }
  } catch (err) {
    failStep(report, "inputs", `failed to parse article.md: ${(err as Error).message}`);
    return report;
  }
  const audioConfig = parseYaml(
    await readFile(audioConfigPath, "utf8"),
  ) as AudioConfigShape;

  try {
    await runStep(report, "sync-storyboard", idempotent, dryRun, () =>
      syncStoryboardFromArticle(opts.projectRoot, article),
    );

    // 1. Generate scene visuals from article's visual descriptions.
    //    Produces assets/images/scene_N.jpg used by ImageBackground.
    //    `--fake` defaults to "none" so scenes stay as AnimatedIllustration
    //    — mock placeholders are too small to be useful backgrounds.
    await runStep(report, "generate-visuals", idempotent, dryRun, () =>
      generateSceneVisuals(opts.projectRoot, article, {
        provider:
          opts.imageProvider ?? (opts.fake ? "none" : "minimax"),
      }),
    );

    // 1b. TTS scenes — narrate each scene's voice-over text.
    await runStep(report, "tts", idempotent, dryRun, () =>
      runTts(opts.projectRoot, article, audioConfig, {
        fake: opts.fake === true,
      }),
    );

    // 1b. Resync storyboard.yaml durations to actual TTS lengths.
    await runStep(report, "sync-durations", idempotent, dryRun, () =>
      syncSceneDurations(opts.projectRoot),
    );

    // 1c. Captions SRT from the duration-synced storyboard — cue times
    // match the rendered video, not the LLM's duration estimates (§16).
    await runStep(report, "captions", idempotent, dryRun, () =>
      writeCaptionsSrt(opts.projectRoot, article.frontmatter.language),
    );

    // 2. Materialize declared BGM/SFX assets.
    await runStep(report, "audio-assets", idempotent, dryRun, () =>
      runAudioAssets(opts.projectRoot, audioConfig, {
        ...(opts.bgmDir !== undefined ? { bgmDir: opts.bgmDir } : {}),
        ...(opts.sfxDir !== undefined ? { sfxDir: opts.sfxDir } : {}),
        ...(opts.musicProvider !== undefined
          ? { musicProvider: opts.musicProvider }
          : {}),
      }),
    );

    // 3. Render preview (compile article → VDSL → mp4).
    await runStep(report, "render-preview", idempotent, dryRun, () =>
      runRenderPreview(opts.projectRoot, article),
    );

    // 4. Mix narration + BGM + SFX cues.
    await runStep(report, "mix", idempotent, dryRun, () =>
      runMix(opts.projectRoot, audioConfig),
    );
  } catch {
    // runStep already recorded the failure; later steps depend on the
    // failed one's outputs, so stop here and let the CLI report it.
  }

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

/**
 * Refresh storyboard.yaml from the current article.md so the renderer
 * always sees the up-to-date scene list. Only rewrites when the
 * article's scene IDs differ from the storyboard's (preserves
 * hand-edited component/props on matching scenes).
 */
async function syncStoryboardFromArticle(
  projectRoot: string,
  article: ParsedArticle,
): Promise<string[]> {
  const storyboardPath = path.join(
    projectRoot,
    "storyboard",
    "storyboard.yaml",
  );
  if (!existsSync(storyboardPath)) {
    await mkdir(path.dirname(storyboardPath), { recursive: true });
    await writeFile(
      storyboardPath,
      articleToStoryboardYaml(article),
      "utf8",
    );
    return ["storyboard.yaml: created from article.md"];
  }

  const yamlText = readFileSync(storyboardPath, "utf8");
  let parsed: {
    scenes?: { id?: string; visual?: { component?: string } }[];
  };
  try {
    parsed = parseYaml(yamlText) as typeof parsed;
  } catch {
    parsed = { scenes: [] };
  }

  const articleIds = article.scenes.map((_, i) => `scene-${String(i + 1).padStart(2, "0")}`);
  const storyboardIds = (parsed.scenes ?? []).map((s) => s.id ?? "");
  const idsMatch =
    articleIds.length === storyboardIds.length &&
    articleIds.every((id, i) => id === storyboardIds[i]);

  if (idsMatch) return [];

  await writeFile(storyboardPath, articleToStoryboardYaml(article), "utf8");
  return [`storyboard.yaml: ${articleIds.length} scenes synced from article.md`];
}

/**
 * Generate an AI image for each scene's `visual:` description and save
 * to `assets/images/scene_N.jpg`. Idempotent — skips scenes whose image
 * already exists. When the provider is "none" or a scene has no visual
 * description, it's skipped and the renderer falls back to
 * AnimatedIllustration geometric shapes.
 *
 * v0.4 (T3): when `--image-provider minimax`, the article's one-line
 * `visual:` is rewritten into a real image prompt (subject · lighting ·
 * composition · style) via `expandScenePrompt`. The expansion is cached
 * on disk so re-runs are free; the `.prompt.txt` sidecar next to each
 * JPG is auditable.
 */
async function generateSceneVisuals(
  projectRoot: string,
  article: ParsedArticle,
  opts: { provider: "minimax" | "mock" | "none" },
): Promise<string[]> {
  if (opts.provider === "none") return [];

  const imageDir = path.join(projectRoot, "assets", "images");
  await mkdir(imageDir, { recursive: true });

  const isMock = opts.provider === "mock";
  const provider: ImageProvider =
    opts.provider === "minimax"
      ? new MiniMaxImageProvider()
      : new MockImageProvider();
  const reqWidth = isMock ? 64 : 1920;
  const reqHeight = isMock ? 36 : 1080;

  // v0.4 (T3): MiniMax image path needs an LLM to rewrite the prompt.
  // Mock path passes null and skips expansion entirely.
  const expansionProvider = isMock ? null : new MiniMaxProvider();

  const outputs: string[] = [];
  const generatedImages: string[] = [];
  // Scenes rendered by their own visual families (svg/canvas/excalidraw
  // components, or already ImageBackground) never consume the generated
  // JPG — skip them so image quota is spent only where it lands on screen.
  const selfRendered = selfRenderedSceneNumbers(projectRoot);
  for (let i = 0; i < article.scenes.length; i++) {
    const scene = article.scenes[i]!;
    const visual = scene.visual ?? "";
    if (!visual || visual.trim().length === 0) continue;
    if (selfRendered.has(i + 1)) continue;

    const imagePath = path.join(imageDir, `scene_${i + 1}.jpg`);
    if (existsSync(imagePath)) {
      generatedImages.push(imagePath);
      continue; // idempotent
    }

    let promptForImage = visual;
    if (expansionProvider) {
      try {
        const { prompt } = await expandScenePrompt(
          {
            id: scene.id,
            visual,
            caption: scene.caption,
            narration: scene.narration,
          },
          expansionProvider,
          projectRoot,
          i + 1,
        );
        promptForImage = prompt;
        outputs.push(
          `assets/images/scene_${i + 1}.prompt.txt (LLM-expanded)`,
        );
      } catch (err) {
        // Fall back to the raw visual line so a provider hiccup doesn't
        // stall the whole render. The sidecar isn't written in that case.
        outputs.push(
          `scene_${i + 1}: prompt expansion failed, using raw visual — ${(err as Error).message.slice(0, 60)}`,
        );
      }
    }

    try {
      const result = await provider.generate({
        prompt: promptForImage,
        width: reqWidth,
        height: reqHeight,
      });
      await writeFile(imagePath, result.bytes);
      outputs.push(`assets/images/scene_${i + 1}.jpg`);
      generatedImages.push(imagePath);
    } catch (err) {
      // Non-fatal: scene falls back to AnimatedIllustration.
      outputs.push(
        `scene_${i + 1}: image gen failed — ${(err as Error).message.slice(0, 60)}`,
      );
    }
  }

  if (generatedImages.length > 0) {
    const switched = updateStoryboardForImages(projectRoot, generatedImages);
    outputs.push(
      `storyboard.yaml: ${switched}/${generatedImages.length} scenes switched to ImageBackground`,
    );
  }
  return outputs;
}

/**
 * Swap AnimatedIllustration → ImageBackground in storyboard.yaml for
 * scenes that have a generated image. Uses yaml parse/stringify (not
 * line regex) because this is a structural change, not a value tweak.
 */
/** 1-based numbers of storyboard scenes whose component draws its own
 * visuals (anything but AnimatedIllustration, which is the only one the
 * image swap rewrites). Empty when the storyboard is unreadable. */
function selfRenderedSceneNumbers(projectRoot: string): Set<number> {
  const storyboardPath = path.join(
    projectRoot,
    "storyboard",
    "storyboard.yaml",
  );
  try {
    const parsed = parseYaml(
      readFileSync(storyboardPath, "utf8"),
    ) as {
      scenes?: { id?: string; visual?: { component?: string } }[];
    };
    const out = new Set<number>();
    for (const scene of parsed.scenes ?? []) {
      if (scene.visual?.component === "AnimatedIllustration") continue;
      const m = scene.id?.match(/scene[-_]?(\d+)/);
      if (m) out.add(parseInt(m[1]!, 10));
    }
    return out;
  } catch {
    return new Set();
  }
}

function updateStoryboardForImages(
  projectRoot: string,
  imagePaths: string[],
): number {
  const storyboardPath = path.join(
    projectRoot,
    "storyboard",
    "storyboard.yaml",
  );
  if (!existsSync(storyboardPath)) return 0;

  const yamlText = readFileSync(storyboardPath, "utf8");
  let parsed: {
    scenes?: {
      id?: string;
      visual?: {
        component?: string;
        props?: Record<string, unknown>;
      };
    }[];
  };
  try {
    parsed = parseYaml(yamlText) as typeof parsed;
  } catch {
    return 0;
  }
  if (!parsed.scenes) return 0;

  let switched = 0;
  for (const scene of parsed.scenes) {
    if (scene.visual?.component !== "AnimatedIllustration") continue;
    const idNum = scene.id?.match(/scene[-_]?(\d+)/)?.[1];
    if (!idNum) continue;
    const imagePath = imagePaths.find((p) =>
      p.includes(`scene_${parseInt(idNum, 10)}.`),
    );
    if (!imagePath) continue;

    const prevText =
      typeof scene.visual.props?.text === "string"
        ? (scene.visual.props.text as string)
        : undefined;
    scene.visual.component = "ImageBackground";
    scene.visual.props = {
      src: imagePath,
      ...(prevText !== undefined ? { caption: prevText } : {}),
    };
    switched++;
  }

  if (switched > 0) {
    writeFileSync(storyboardPath, yamlStringify(parsed), "utf8");
  }
  return switched;
}

interface AudioConfigShape {
  voice?: string;
  bgm?: string | null;
  /** Multi-BGM timeline (branding 2026-10-05) — overrides `bgm`. */
  bgm_tracks?: { track: string; until_sec?: number }[];
  bgm_fade_in_sec?: number;
  bgm_fade_out_sec?: number;
  pause_between_sentences_sec?: number;
  sfx?: Record<string, string>;
}

/**
 * Probe each scene's TTS WAV and rewrite storyboard.yaml so `duration:`
 * matches actual audio length. Now lives in @video/media (shared with
 * `video preview`, which must sync before validating audio-vs-scene).
 */
export { syncSceneDurations as syncStoryboardDurations } from "@video/media";

/** SRT from the duration-synced storyboard: cue boundaries accumulate the
 * MEASURED scene durations, so captions stay aligned when TTS runs longer
 * than the LLM estimated (the common case — that's why sync exists). */
async function writeCaptionsSrt(
  projectRoot: string,
  lang: string,
): Promise<string[]> {
  const scenes = await readSceneTimings(projectRoot);
  const srtPath = path.join(projectRoot, "captions", `${lang}.srt`);
  await mkdir(path.dirname(srtPath), { recursive: true });
  let cursor = 0;
  const cues = scenes.map((s, i) => {
    const start = cursor;
    const end = start + s.duration;
    cursor = end;
    return `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${s.narration}\n`;
  });
  await writeFile(srtPath, cues.join("\n"), "utf8");
  return [`captions/${lang}.srt`];
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
  const pause =
    typeof audioConfig.pause_between_sentences_sec === "number"
      ? audioConfig.pause_between_sentences_sec
      : undefined;
  const audioDir = path.join(projectRoot, "assets", "audio");
  await mkdir(audioDir, { recursive: true });

  const outputs: string[] = [];
  for (const scene of article.scenes) {
    const wavPath = path.join(audioDir, `${scene.id}.wav`);
    // Cache key: the narration TEXT (hashed), voice, and pause option —
    // not file existence. An existence check silently kept stale WAVs
    // after any re-draft/narration edit, desyncing audio from the
    // picture and subtitles (the render cache uses the same
    // content-hash discipline).
    const cacheKey = ttsCacheKey(scene.narration, voice, pause);
    const meta = await readTtsMeta(wavPath);
    if (meta !== null && meta.cacheKey === cacheKey && existsSync(wavPath)) {
      continue;
    }
    const result = await provider.synthesize({
      text: scene.narration,
      voice,
      language: article.frontmatter.language,
      ...(pause !== undefined ? { pauseBetweenSentencesSec: pause } : {}),
    });
    // Same WAV/MP3 detection as @video/cli runAudio.
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
    await writeTtsMeta(wavPath, { cacheKey, synthesizedAt: new Date().toISOString() });
    outputs.push(`assets/audio/${scene.id}.wav`);
  }

  return outputs;
}

interface TtsCacheMeta {
  cacheKey: string;
  synthesizedAt: string;
}

function ttsCacheKey(
  narration: string,
  voice: string,
  pauseSec: number | undefined,
): string {
  return (
    "sha256:" +
    createHash("sha256")
      .update(`${voice}\u0000${pauseSec ?? "-"}\u0000${narration.trim()}`)
      .digest("hex")
  );
}

async function readTtsMeta(wavPath: string): Promise<TtsCacheMeta | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(
      await readFile(`${wavPath}.json`, "utf8"),
    ) as TtsCacheMeta;
  } catch {
    return null;
  }
}

async function writeTtsMeta(
  wavPath: string,
  meta: TtsCacheMeta,
): Promise<void> {
  const { writeFile: wf } = await import("node:fs/promises");
  await wf(`${wavPath}.json`, JSON.stringify(meta, null, 2), "utf8");
}

function formatSrtTime(sec: number): string {
  // Decompose from rounded total ms — per-field rounding can emit
  // invalid SRT like 00:00:59,1000.
  const totalMs = Math.round(sec * 1000);
  const h = Math.floor(totalMs / 3_600_000).toString().padStart(2, "0");
  const m = (Math.floor(totalMs / 60_000) % 60).toString().padStart(2, "0");
  const s = (Math.floor(totalMs / 1000) % 60).toString().padStart(2, "0");
  const ms = (totalMs % 1000).toString().padStart(3, "0");
  return `${h}:${m}:${s},${ms}`;
}

export interface AudioAssetDirs {
  bgmDir?: string;
  sfxDir?: string;
  /** BGM generation backend (branding 2026-10-05). "auto" (default) uses
   * MiniMax music generation when MINIMAX_API_KEY is set, else mock.
   * "minimax" forces it (fails loudly without a key); "mock" disables.
   * bgmDir always wins over all of these. */
  musicProvider?: "auto" | "minimax" | "mock";
  /** Test seam — overrides the constructed MiniMax music provider. */
  minimaxProvider?: Pick<AudioAssetProvider, "pickBackgroundMusic">;
}

/** Materialize the BGM/SFX tags declared in audio-config.yaml into
 *  assets/audio-assets/{bgm,sfx}/{tag}.wav. With bgmDir/sfxDir the
 *  bytes come from the user's own library (file-based lookup); without
 *  them a mock silent placeholder is written so downstream mixing has
 *  valid audio. Exported for direct testing. */
export async function runAudioAssets(
  projectRoot: string,
  config: AudioConfigShape,
  dirs: AudioAssetDirs = {},
): Promise<string[]> {
  const outputs: string[] = [];
  const assetsDir = path.join(projectRoot, "assets", "audio-assets");
  await mkdir(path.join(assetsDir, "bgm"), { recursive: true });
  await mkdir(path.join(assetsDir, "sfx"), { recursive: true });

  const mock = () => new MockAudioAssetProvider();
  const fileBased = () =>
    new FileBasedAudioAssetProvider({
      bgmDirectory: dirs.bgmDir ?? dirs.sfxDir ?? ".",
      sfxDirectory: dirs.sfxDir ?? dirs.bgmDir ?? ".",
    });

  const useMinimax = (() => {
    const mode = dirs.musicProvider ?? "auto";
    if (mode === "mock") return false;
    if (dirs.bgmDir) return false; // user library wins
    if (mode === "minimax") return true;
    return Boolean(process.env["MINIMAX_API_KEY"]);
  })();
  const minimax = () => dirs.minimaxProvider ?? new MiniMaxMusicProvider();

  /** Generate one named BGM tag: file-based library → MiniMax music gen
   * (degrading to mock on failure so the pipeline keeps moving) → mock. */
  const materializeBgm = async (tag: string): Promise<string | null> => {
    const out = path.join(assetsDir, "bgm", `${tag}.wav`);
    if (existsSync(out)) return null;
    if (dirs.bgmDir) {
      const r = await fileBased().pickBackgroundMusic({ tag });
      await writeFile(out, r.bytes);
      return `assets/audio-assets/bgm/${tag}.wav (${r.source}, ${r.license})`;
    }
    if (useMinimax) {
      try {
        const r = await minimax().pickBackgroundMusic({ tag });
        await writeFile(out, r.bytes);
        return `assets/audio-assets/bgm/${tag}.wav (${r.source}, ${r.license})`;
      } catch (err) {
        console.error(
          `  ! minimax music gen failed for "${tag}" — falling back to mock: ${(err as Error).message.slice(0, 120)}`,
        );
      }
    }
    const r = await mock().pickBackgroundMusic({ tag });
    await writeFile(out, r.bytes);
    return `assets/audio-assets/bgm/${tag}.wav (${r.source}, ${r.license})`;
  };

  if (config.bgm && typeof config.bgm === "string") {
    const line = await materializeBgm(config.bgm);
    if (line) outputs.push(line);
  }
  // Multi-BGM timeline: materialize every NAMED track tag exactly like
  // `bgm` above (path-shaped tracks point at existing files instead).
  for (const t of config.bgm_tracks ?? []) {
    if (isTrackPath(t.track)) continue;
    const line = await materializeBgm(t.track);
    if (line) outputs.push(line);
  }
  const sfx = config.sfx ?? {};
  for (const [sceneId, tag] of Object.entries(sfx)) {
    const out = path.join(assetsDir, "sfx", `${tag}.wav`);
    if (!existsSync(out)) {
      const provider = dirs.sfxDir ? fileBased() : mock();
      const r = await provider.pickSoundEffect({ tag });
      await writeFile(out, r.bytes);
      outputs.push(
        `assets/audio-assets/sfx/${tag}.wav [${sceneId}] (${r.source}, ${r.license})`,
      );
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
  // Mirror what `video preview` actually writes.
  return ["output/preview.mp4", "output/preview-faststart.mp4"];
}

async function runMix(
  projectRoot: string,
  config: AudioConfigShape,
): Promise<string[]> {
  const slug = path.basename(projectRoot);
  const workspaceRoot = path.dirname(path.dirname(projectRoot));
  // Translate audio-config.yaml → video mix CLI flags rather than
  // duplicating the existing pipeline.
  const mixArgs: string[] = [
    "node",
    "packages/cli/dist/index.js",
    "mix",
    slug,
  ];
  if (config.bgm && typeof config.bgm === "string") {
    const bgmAbs = path.join(projectRoot, "assets", "audio-assets", "bgm", `${config.bgm}.wav`);
    mixArgs.push("--bgm", bgmAbs);
  }
  if (config.bgm_tracks && config.bgm_tracks.length > 0) {
    // Multi-BGM timeline (branding 2026-10-05): pre-render the ordered
    // windows into one wav, then mix it through the normal single-`--bgm`
    // path — the ducker and master fades in mix.ts apply unchanged.
    const wsRoot = workspaceRootFor(projectRoot);
    const total = await totalNarrationSeconds(projectRoot);
    const windows = planBgmWindows(
      config.bgm_tracks,
      total,
      (track) => {
        if (!isTrackPath(track)) {
          return path.join(projectRoot, "assets", "audio-assets", "bgm", `${track}.wav`);
        }
        // Path tracks: project-relative first, then workspace root —
        // shared brand audio lives in <ws>/assets/brand/.
        const inProject = path.resolve(projectRoot, track);
        if (existsSync(inProject)) return inProject;
        if (wsRoot && existsSync(path.resolve(wsRoot, track))) {
          return path.resolve(wsRoot, track);
        }
        return inProject; // missing → ffmpeg fails loudly downstream
      },
    );
    const timelinePath = await renderBgmTimeline(
      windows,
      path.join(projectRoot, "assets", "audio-assets", "bgm", "_timeline.wav"),
    );
    console.log(
      `  bgm timeline: ${windows.map((w) => `${path.basename(w.path)}[${w.startSec.toFixed(1)}-${w.endSec.toFixed(1)}s]`).join(" → ")}`,
    );
    mixArgs.push("--bgm", timelinePath);
  }
  if (typeof config.bgm_fade_in_sec === "number") {
    mixArgs.push("--bgm-fade-in", String(config.bgm_fade_in_sec));
  }
  if (typeof config.bgm_fade_out_sec === "number") {
    mixArgs.push("--bgm-fade-out", String(config.bgm_fade_out_sec));
  }
  await runCli(mixArgs, { cwd: workspaceRoot });
  // Mirror what `video mix` actually writes.
  return ["output/final-mixed.mp4"];
}

/** A track value is a FILE PATH when it looks like one — contains a
 * separator or an audio extension. Everything else is a named tag. */
function isTrackPath(track: string): boolean {
  return /[\\/]/.test(track) || /\.(wav|mp3|m4a|ogg|flac)$/i.test(track);
}

/** `<anywhere>/projects/<slug>` → `<anywhere>`; null otherwise. Shared
 * branding resources (brand.yaml, assets/brand/) live at the workspace
 * root and every project references them. */
function workspaceRootFor(projectRoot: string): string | null {
  const parentDir = path.dirname(projectRoot);
  if (path.basename(parentDir) === "projects") {
    return path.dirname(parentDir);
  }
  return null;
}

/** Sum the measured scene narration wavs — the timeline's `until_sec`
 * values are absolute video seconds, so the windows need the real total,
 * not the article's estimate. */
async function totalNarrationSeconds(projectRoot: string): Promise<number> {
  const audioDir = path.join(projectRoot, "assets", "audio");
  const files = (await readdir(audioDir))
    .filter((f) => /^scene[-_]\d+\.wav$/i.test(f))
    .sort();
  if (files.length === 0) {
    throw new Error(`no scene narration wavs in ${audioDir} — run TTS first`);
  }
  let total = 0;
  for (const f of files) {
    total += await probeAudioDuration(path.join(audioDir, f));
  }
  return total;
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

/** Same mp3ToWav helper as @video/cli runAudio — kept local to avoid a
 * circular import from the CLI package. */
/** Convert mp3 bytes (from TTS) to 44.1kHz mono WAV, padding to
 * `minDurationSec` total when the narration is shorter. Never truncates:
 * `apad=whole_dur` only tops up to the minimum, so a narration that runs
 * longer than the article's estimate survives intact (the LLM routinely
 * underestimates) and syncStoryboardDurations rewrites the storyboard to
 * the measured length. */
async function mp3ToWav(
  mp3Bytes: Uint8Array,
  minDurationSec: number,
): Promise<Uint8Array> {
  const dir = await (await import("node:fs/promises")).mkdtemp(
    path.join(os.tmpdir(), "video-make-tts-"),
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
      `apad=whole_dur=${minDurationSec}`,
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
