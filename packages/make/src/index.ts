import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  parseArticleWithRecovery,
  articleToStoryboardYaml,
  expandScenePrompt,
  resolveImageStyle,
  stylePromptSuffix,
  characterRootFor,
  IMAGE_PROMPT_REVISION,
  type ParsedArticle,
} from "@video/draft";
import { MiniMaxProvider } from "@video/llm";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import {
  FakeTTSProvider,
  EdgeTTSProvider,
  VoiceboxTTSProvider,
  MinimaxTTSProvider,
  f5ttsStatus,
  voiceboxStatus,
  type TTSProvider,
} from "@video/tts";
import { resolveNarration } from "./narration.js";
import {
  buildCaptionCues,
  mp3ToWav,
  readSceneTimings,
  syncSceneDurations,
  probeAudioDuration,
} from "@video/media";
import { planBgmWindows, renderBgmTimeline } from "@video/audio-mix";
import {
  curatedBgmDirectory,
  FileBasedAudioAssetProvider,
  listMoods,
  loadLocalBgmLibrary,
  MockAudioAssetProvider,
  resolveBgmTag,
  type AudioAssetProvider,
} from "@video/audio-assets";
import {
  GeminiImageProvider,
  MiniMaxImageProvider,
  MockImageProvider,
  OpenAIImageProvider,
  type ImageProvider,
  loadBakeManifest,
  bakeDigestFor,
  runBakeText,
} from "@video/media-generators";
import { loadLessonStore, promptRules, rulesDigest } from "@video/learn";
import { mixProject, type MixProjectOptions } from "./mix.js";
import {
  imageCacheKey,
  readImageCacheSidecar,
  requestedImageSize,
  selfRenderedSceneNumbers,
  visualsGateState,
  writeImageCacheSidecar,
} from "./visual-cache.js";
import {
  ttsCacheKey,
  ttsCacheInputsFor,
  ttsScenesFromArticle,
  effectiveTtsVoice,
  type TtsScene,
} from "./tts-cache.js";

export {
  ttsCacheKey,
  ttsCacheInputsFor,
  ttsScenesFromArticle,
  ZH_VOICE,
  EN_VOICE,
  type TtsCacheKeyInput,
  type TtsScene,
  type TtsSettings,
} from "./tts-cache.js";
export { computeMakeImpact, formatImpact } from "./impact.js";
export {
  listAvailableBgms,
  mixProject,
  parseSfxFlags,
  pickNarrations,
  resolveBgmByTag,
  type MixOutcome,
  type MixProjectOptions,
} from "./mix.js";
export {
  imageSceneNumbers,
  readVisualsCheckpoint,
  rejectVisualsScene,
  visualsGateState,
  writeVisualsCheckpoint,
} from "./visual-cache.js";

/**
 * `video-progress/1` — live pipeline progress events (v0.7.1 plan).
 *
 * Emission is pure: events carry data, never print. The CLI owns the
 * stderr formatting (`formatProgressEvent` in `packages/cli/src/ui.ts`);
 * library callers pass `onEvent` to observe, or nothing to stay silent.
 */
export type ProgressEventKind = "start" | "done" | "fail" | "heartbeat";

export interface ProgressEvent {
  kind: ProgressEventKind;
  /** Step name ("tts") or item label ("tts scene_03"). */
  label: string;
  /** Whole-call seconds — set on done/fail/heartbeat. */
  elapsedSec?: number;
  /** 1-based position within a scene loop, when known. */
  index?: number;
  total?: number;
  message?: string;
}

export type ProgressEmit = (e: ProgressEvent) => void;

export const noopEmit: ProgressEmit = () => {};

/** Elapsed whole seconds since `t0`. */
/**
 * v0.12: run the Pillow text-overlay pass for one project, then stamp
 * each scene's `visual.props.textOverlaySrc` so the renderer knows
 * where to look. The Pillow script is intentionally written in Python
 * — Pillow is the project standard for image-text compositing, and the
 * CLI language stays out of the way.
 *
 * Returns the list of generated overlay files for the run report.
 */
async function runTextOverlayPass(projectRoot: string): Promise<string[]> {
  // The script lives at <repo>/scripts/pillow-text-overlay.py. The
  // `make` step runs from the repo root (CLI cwd), so the relative
  // path is stable regardless of which project triggered the run.
  const scriptPath = path.resolve(
    process.cwd(),
    "scripts",
    "pillow-text-overlay.py",
  );
  if (!existsSync(scriptPath)) {
    return [
      `text-overlay: skipped — ${path.relative(process.cwd(), scriptPath)} not found`,
    ];
  }
  // Find a python that has Pillow + PyYAML installed. The CLI's
  // pre-flight (`bash check_setup.sh`) only checks the LLM deps; the
  // Pillow stack is opt-in, so this step no-ops gracefully when the
  // user hasn't installed Pillow yet.
  const pythonCandidates =
    process.env["VIDEO_PYTHON"] !== undefined
      ? [process.env["VIDEO_PYTHON"]]
      : ["python3", "python"];
  let python: string | undefined;
  for (const cand of pythonCandidates) {
    const probe = spawnSync(
      cand,
      ["-c", "from PIL import Image, ImageDraw, ImageFont; import yaml"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (probe.status === 0) {
      python = cand;
      break;
    }
  }
  if (python === undefined) {
    return [
      `text-overlay: skipped — no python with Pillow + PyYAML found (tried ${pythonCandidates.join(", ")})`,
    ];
  }
  const projectSlug = path.basename(projectRoot);
  const proc = spawnSync(python, [scriptPath, projectSlug], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (proc.status !== 0) {
    const stderr = (proc.stderr ?? "").split("\n").slice(-3).join(" | ");
    return [
      `text-overlay: Pillow script failed (exit ${proc.status}) — ${stderr}`,
    ];
  }
  // Stamp textOverlaySrc into the storyboard's ImageBackground scenes.
  // The make run is the only place that knows both the project root
  // and the freshly-generated overlay paths, so the stamp lives here
  // (not in sync-storyboard, which is keyed on article.md content).
  const storyboardPath = path.join(
    projectRoot,
    "storyboard",
    "storyboard.yaml",
  );
  if (!existsSync(storyboardPath)) {
    return ["text-overlay: storyboard.yaml missing — nothing to stamp"];
  }
  const parsed = parseYaml(readFileSync(storyboardPath, "utf8")) as {
    scenes?: Array<{
      id?: string;
      visual?: { component?: string; props?: Record<string, unknown> };
    }>;
  };
  const overlays: string[] = [];
  for (const scene of parsed.scenes ?? []) {
    if (scene.visual?.component !== "ImageBackground") continue;
    const idNum = scene.id?.match(/scene[-_]?(\d+)/)?.[1];
    if (idNum === undefined) continue;
    // pillow-text-overlay.py writes UNPADDED names (scene_2.png) while
    // ids are zero-padded (scene-02) — normalize or 2-9 never match.
    const overlayPath = path.join(
      projectRoot,
      "assets",
      "images",
      "text",
      `scene_${parseInt(idNum, 10)}.png`,
    );
    if (!existsSync(overlayPath)) continue;
    scene.visual.props = {
      ...(scene.visual.props ?? {}),
      textOverlaySrc: overlayPath,
    };
    overlays.push(overlayPath);
  }
  writeFileSync(storyboardPath, yamlStringify(parsed), "utf8");
  return [
    `text-overlay: Pillow wrote ${overlays.length} overlay file(s)`,
    `text-overlay: stamped textOverlaySrc on ${overlays.length} scene(s)`,
    ...(proc.stdout ? [proc.stdout.trim()] : []),
  ];
}

function elapsedSinceSec(t0: number): number {
  return Math.round((Date.now() - t0) / 1000);
}

/**
 * Run `run()`, emitting `heartbeat` events through `emit` while it
 * waits: first beat once the call has lasted `afterSec` (default 30),
 * then every `everySec` (default 20). Beats stop when the promise
 * settles. This is the "time to time" signal that keeps a long single
 * call (image generation, render, LLM draft) distinguishable from a hang.
 */
export function heartbeat<T>(
  label: string,
  run: () => Promise<T>,
  emit: ProgressEmit = noopEmit,
  opts: { everySec?: number; afterSec?: number } = {},
): Promise<T> {
  const everyMs = (opts.everySec ?? 20) * 1000;
  const afterMs = (opts.afterSec ?? 30) * 1000;
  const t0 = Date.now();
  // First beat exactly at afterMs (setTimeout), then every everyMs — the
  // old single-interval version fired the first beat at the first
  // everyMs multiple ≥ afterMs (40s for the 30/20 defaults).
  const beat = () =>
    emit({
      kind: "heartbeat",
      label,
      elapsedSec: elapsedSinceSec(t0),
    });
  let interval: NodeJS.Timeout | undefined;
  const first = setTimeout(() => {
    beat();
    interval = setInterval(beat, everyMs);
  }, afterMs);
  return run().finally(() => {
    clearTimeout(first);
    clearInterval(interval); // no-op when the first beat never fired
  });
}

export interface MakeOptions {
  projectRoot: string;
  /** Use offline fake provider (no Edge-TTS network call). */
  fake?: boolean;
  /** Skip steps whose outputs are newer than their inputs. Default true. */
  idempotent?: boolean;
  /** If true, log what would be done without executing. */
  dryRun?: boolean;
  /** Image provider for scene visuals: "minimax" | "openai" | "gemini"
   * (hosted AI image APIs), "mock" (deterministic placeholder), or
   * "none" (skip image generation; scenes fall back to
   * AnimatedIllustration shapes). */
  imageProvider?: "minimax" | "openai" | "gemini" | "mock" | "none";
  /** Local music library for real BGM — a directory containing
   * `{tag}.wav` (or any .wav whose name contains the tag). Without it
   * the audio-assets step writes a mock silent placeholder. */
  bgmDir?: string;
  /** Local SFX library, same lookup rule as bgmDir. */
  sfxDir?: string;
  /** BGM generation backend: "auto" (default) uses MiniMax music
   * generation when MINIMAX_API_KEY is set, else silent mock. */

  /** v0.7.1 (video-progress/1): live progress events (step start/done,
   * per-scene items, heartbeats). Default noop — the CLI passes a
   * stderr printer. */
  onEvent?: ProgressEmit;
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

/** Process-boundary adapters, injectable so tests can drive the whole
 *  pipeline without ffmpeg/Remotion/CLI subprocesses. The defaults shell
 *  out (`video preview`, `video mix`, `ffmpeg`); everything else in the
 *  pipeline is already offline-selectable via MakeOptions (fake/mock
 *  providers), so these three are the only seams tests need. */
export interface MakeDeps {
  renderPreview?: (
    projectRoot: string,
    article: ParsedArticle,
  ) => Promise<string[]>;
  mix?: (projectRoot: string, config: AudioConfigShape) => Promise<string[]>;
  mp3ToWav?: (
    mp3Bytes: Uint8Array,
    minDurationSec: number,
  ) => Promise<Uint8Array>;
}

/** Run the make pipeline against an article.md + audio-config.yaml project. */
export async function runMake(
  opts: MakeOptions,
  deps: MakeDeps = {},
): Promise<MakeReport> {
  const idempotent = opts.idempotent !== false;
  const dryRun = opts.dryRun === true;
  const report: MakeReport = { steps: [], outputFiles: [] };

  // video-progress/1: one stderr-bound event sink shared by every step.
  const emit = opts.onEvent ?? noopEmit;
  const step = (name: string, run: () => Promise<string[]>) =>
    runStep(report, name, idempotent, dryRun, run, emit);

  // 0. Inputs must exist.
  const articlePath = path.join(opts.projectRoot, "article.md");
  const audioConfigPath = path.join(opts.projectRoot, "audio-config.yaml");
  if (!existsSync(articlePath)) {
    failStep(report, "inputs", `article.md not found at ${articlePath}`);
    return report;
  }
  if (!existsSync(audioConfigPath)) {
    failStep(
      report,
      "inputs",
      `audio-config.yaml not found at ${audioConfigPath}`,
    );
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
    failStep(
      report,
      "inputs",
      `failed to parse article.md: ${(err as Error).message}`,
    );
    return report;
  }
  const audioConfig = parseYaml(
    await readFile(audioConfigPath, "utf8"),
  ) as AudioConfigShape;

  // v0.8 (G4): visuals approval gate — opt-in via `require_visual_approval:
  // true` in article.md frontmatter. make refuses to render unless the
  // on-disk image set matches an approved visuals checkpoint. In --dry-run
  // the impact table reports gate state instead (this block is skipped).
  if (article.frontmatter["require_visual_approval"] === true && !dryRun) {
    const gate = visualsGateState(opts.projectRoot);
    if (gate.state !== "ok") {
      failStep(
        report,
        "visuals-gate",
        gate.state === "missing-checkpoint"
          ? "require_visual_approval: true but no approved visuals checkpoint — run `video visuals <project>`, review the contact sheet, then `video approve visuals <project>`"
          : `visuals changed since approval — stale: ${gate.staleScenes.map((n) => `scene_${n}`).join(", ")}. Re-run \`video visuals <project>\`, then \`video approve visuals <project>\``,
      );
      return report;
    }
    report.steps.push({
      name: "visuals-gate",
      status: "ran",
      message: "image set matches the approved visuals checkpoint",
    });
  }

  try {
    await step("sync-storyboard", () =>
      syncStoryboardFromArticle(opts.projectRoot, article),
    );

    // 1. Generate scene visuals from article's visual descriptions.
    //    Produces assets/images/scene_N.jpg used by ImageBackground.
    //    `--fake` defaults to "none" so scenes stay as AnimatedIllustration
    //    — mock placeholders are too small to be useful backgrounds.
    await step("generate-visuals", () =>
      generateSceneVisuals(opts.projectRoot, article, {
        provider: resolveImageProvider(
          opts.fake,
          opts.imageProvider,
          article.frontmatter.image_provider,
        ),
        onEvent: emit,
      }),
    );

    // 1b. v0.12: Pillow text-overlay pass. Reads storyboard.yaml, walks
    //     every scene, and writes a transparent PNG to
    //     assets/images/text/scene_N.png with the scene's key-info
    //     title rendered on top. The renderer composites this above the
    //     background image and below the captions strip. Run only when
    //     at least one scene is an ImageBackground — the script is a
    //     no-op for non-image scenes, but the noise is not.
    await step("text-overlay", () => runTextOverlayPass(opts.projectRoot));

    // 1b. TTS scenes — narrate each scene's voice-over text.
    await step("tts", () =>
      runTts(
        opts.projectRoot,
        article,
        audioConfig,
        { fake: opts.fake === true },
        deps.mp3ToWav,
        emit,
      ),
    );

    // 1b. Resync storyboard.yaml durations to actual TTS lengths.
    await step("sync-durations", () => syncSceneDurations(opts.projectRoot));

    // 1c. Captions SRT from the duration-synced storyboard — cue times
    // match the rendered video, not the LLM's duration estimates (§16).
    await step("captions", () =>
      writeCaptionsSrt(opts.projectRoot, article.frontmatter.language),
    );

    // 2. Materialize declared BGM/SFX assets.
    await step("audio-assets", () =>
      runAudioAssets(opts.projectRoot, audioConfig, {
        ...(opts.bgmDir !== undefined ? { bgmDir: opts.bgmDir } : {}),
        ...(opts.sfxDir !== undefined ? { sfxDir: opts.sfxDir } : {}),
      }),
    );

    // 3. Render preview (compile article → VDSL → mp4).
    await step("render-preview", () =>
      (deps.renderPreview ?? runRenderPreview)(opts.projectRoot, article),
    );

    // 4. Mix narration + BGM + SFX cues.
    await step("mix", () =>
      (deps.mix ?? runMix)(opts.projectRoot, audioConfig),
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
  emit: ProgressEmit = noopEmit,
): Promise<void> {
  if (dryRun) {
    report.steps.push({ name, status: "would-run" });
    return;
  }
  const t0 = Date.now();
  emit({ kind: "start", label: name });
  try {
    const outputs = await heartbeat(name, run, emit);
    emit({ kind: "done", label: name, elapsedSec: elapsedSinceSec(t0) });
    report.steps.push({ name, status: "ran", outputs });
  } catch (err) {
    emit({
      kind: "fail",
      label: name,
      elapsedSec: elapsedSinceSec(t0),
      message: (err as Error).message,
    });
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
/**
 * Carry the motion plan across a storyboard re-derivation.
 *
 * `video motion` writes the plan (per-scene `animations`, `transition`,
 * and the `kenBurnsScale` that holds a still frame still) into
 * storyboard.yaml — but storyboard.yaml is DERIVED from article.md. So
 * any re-derivation (a changed scene count, a corrupt file, a hand
 * re-derive) silently dropped the plan: the still frames started
 * drifting again, with nothing in the log to say so.
 *
 * Scenes present in both copies keep their plan; new scenes get none.
 */
export function preserveMotionPlan(
  next: { scenes?: Record<string, unknown>[] },
  prev: { scenes?: { id?: string }[] },
): number {
  const prevById = new Map<string, Record<string, unknown>>();
  for (const s of prev.scenes ?? []) {
    if (typeof s.id === "string") {
      prevById.set(s.id, s as Record<string, unknown>);
    }
  }
  let kept = 0;
  for (const scene of next.scenes ?? []) {
    const id = scene["id"];
    if (typeof id !== "string") continue;
    const old = prevById.get(id);
    if (old === undefined) continue;
    for (const field of ["animations", "transition"]) {
      if (scene[field] === undefined && old[field] !== undefined) {
        scene[field] = old[field];
        kept += 1;
      }
    }
    const oldProps = (
      old["visual"] as { props?: Record<string, unknown> } | undefined
    )?.props;
    const newProps = (
      scene["visual"] as { props?: Record<string, unknown> } | undefined
    )?.props;
    if (
      oldProps?.["kenBurnsScale"] !== undefined &&
      newProps !== undefined &&
      newProps["kenBurnsScale"] === undefined
    ) {
      newProps["kenBurnsScale"] = oldProps["kenBurnsScale"];
      kept += 1;
    }
  }
  return kept;
}

export async function syncStoryboardFromArticle(
  projectRoot: string,
  article: ParsedArticle,
): Promise<string[]> {
  const storyboardPath = path.join(
    projectRoot,
    "storyboard",
    "storyboard.yaml",
  );
  const hashPath = path.join(path.dirname(storyboardPath), ".derived-hash");
  // Content-aware sync (2026-10-24): the ids-match fast path used to skip
  // re-derivation even when article content that FEEDS the storyboard
  // changed (frontmatter `captions_source`, per-scene caption/visual/
  // narration/duration) — the operator had to rm the storyboard by hand
  // (hit twice on 2026-10-24). Hash that content into a sidecar and
  // re-derive (keeping the motion plan) whenever it drifts. Pure hand
  // edits to storyboard.yaml still win: the hash only moves when
  // article.md moves.
  const derivedHash = createHash("sha256")
    .update(
      JSON.stringify({
        fm: {
          no_captions: article.frontmatter["no_captions"] === true,
          captions_source: article.frontmatter["captions_source"],
          channel_profile: article.frontmatter["channel_profile"],
        },
        scenes: article.scenes.map((s) => ({
          id: s.id,
          duration: s.duration,
          caption: s.caption,
          visual: s.visual,
          narration: s.narration,
        })),
      }),
    )
    .digest("hex")
    .slice(0, 16);
  const storedHash = existsSync(hashPath)
    ? readFileSync(hashPath, "utf8").trim()
    : null;
  if (!existsSync(storyboardPath)) {
    await mkdir(path.dirname(storyboardPath), { recursive: true });
    await writeFile(
      storyboardPath,
      articleToStoryboardYaml(article),
      "utf8",
    );
    await writeFile(hashPath, derivedHash, "utf8");
    return ["storyboard.yaml: created from article.md"];
  }

  const yamlText = readFileSync(storyboardPath, "utf8");
  let parsed: {
    scenes?: { id?: string; visual?: { component?: string } }[];
  };
  try {
    parsed = parseYaml(yamlText) as typeof parsed;
  } catch (err) {
    // A corrupt storyboard used to fall through as {scenes: []} SILENTLY,
    // which forces the ids-mismatch path below and rewrites the whole
    // file — destroying hand-edited components/props with zero warning.
    // Rewriting is still the only sane recovery; say so loudly.
    console.warn(
      `warning: storyboard.yaml is unparseable (${(err as Error).message}) — regenerating from article.md, hand edits will be lost`,
    );
    parsed = { scenes: [] };
  }

  const articleIds = article.scenes.map(
    (_, i) => `scene-${String(i + 1).padStart(2, "0")}`,
  );
  const storyboardIds = (parsed.scenes ?? []).map((s) => s.id ?? "");
  const idsMatch =
    articleIds.length === storyboardIds.length &&
    articleIds.every((id, i) => id === storyboardIds[i]);

  if (idsMatch && storedHash === derivedHash) return [];

  const derived = articleToStoryboardYaml(article);
  const nextDoc = parseYaml(derived) as {
    scenes?: Record<string, unknown>[];
  };
  const kept = preserveMotionPlan(nextDoc, parsed);
  await writeFile(storyboardPath, yamlStringify(nextDoc), "utf8");
  await writeFile(hashPath, derivedHash, "utf8");
  return [
    idsMatch
      ? `storyboard.yaml: article content changed — re-derived (${articleIds.length} scenes, motion plan kept: ${kept})`
      : `storyboard.yaml: ${articleIds.length} scenes synced from article.md`,
    ...(kept > 0
      ? [`storyboard.yaml: kept the motion plan (${kept} field(s))`]
      : []),
  ];
}

/**
 * Default `--image-provider` when the flag is omitted — `minimax`
 * (image-01). The local 4B diffusion path was the default from v0.5.3
 * until v0.8.1, when it was replaced here and later removed: it cost
 * ~1–3 min/scene on Apple Silicon while every hosted provider returns
 * in seconds.
 */
const DEFAULT_IMAGE_PROVIDER:
  "minimax" | "openai" | "gemini" | "mock" | "none" = "minimax";

const IMAGE_PROVIDER_VALUES = [
  "minimax",
  "openai",
  "gemini",
  "mock",
  "none",
] as const;

/** Type guard — `article.md` is human-edited, so a frontmatter
 *  `image_provider:` may hold anything. Narrows without a cast. */
function isKnownImageProvider(
  value: string | undefined,
): value is "minimax" | "openai" | "gemini" | "mock" | "none" {
  return (
    value !== undefined &&
    (IMAGE_PROVIDER_VALUES as readonly string[]).includes(value)
  );
}

/**
 * The `--image-provider` default in one place — `video make`,
 * `video visuals`, and the read-only `video make --dry-run` impact table
 * must agree or the impact table predicts spend the render never makes.
 *
 * Precedence: explicit flag > `--fake` (⇒ "none") > the project's
 * `article.md` frontmatter `image_provider:` > the global default.
 *
 * `--fake` resolves to "none" rather than "mock": mock placeholders are
 * 64×36, and switching scenes to `ImageBackground` left long videos with
 * blank frames after the title card (v0.3.6).
 */
export function resolveImageProvider(
  fake: boolean | undefined,
  explicit: "minimax" | "openai" | "gemini" | "mock" | "none" | undefined,
  articleDefault?: string,
): "minimax" | "openai" | "gemini" | "mock" | "none" {
  if (explicit !== undefined) return explicit;
  if (fake) return "none";
  // `article.md` is the source of truth for durable project config: a
  // `video draft --image-provider` answer is stamped into the frontmatter
  // and read back here. Unknown values fall through to the default.
  if (isKnownImageProvider(articleDefault)) return articleDefault;
  return DEFAULT_IMAGE_PROVIDER;
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
export async function generateSceneVisuals(
  projectRoot: string,
  article: ParsedArticle,
  opts: {
    provider: "minimax" | "openai" | "gemini" | "mock" | "none";
    onEvent?: ProgressEmit | undefined;
  },
): Promise<string[]> {
  if (opts.provider === "none") return [];

  const imageDir = path.join(projectRoot, "assets", "images");
  await mkdir(imageDir, { recursive: true });

  // v0.10.5: per-scene baked text (titles/quotes). Loaded before the scene
  // loop because the digest joins the image cache key — baked text lives
  // inside the jpg, so it is an input, not a post-effect.
  const bakeManifest = await loadBakeManifest(imageDir);

  const isMock = opts.provider === "mock";
  let provider: ImageProvider;
  if (opts.provider === "minimax") {
    provider = new MiniMaxImageProvider();
  } else if (opts.provider === "openai") {
    provider = new OpenAIImageProvider();
  } else if (opts.provider === "gemini") {
    provider = new GeminiImageProvider();
  } else {
    provider = new MockImageProvider();
  }
  const reqSize = requestedImageSize(opts.provider);
  const reqWidth = reqSize.width;
  const reqHeight = reqSize.height;

  // v0.6: image-style preset from article.md frontmatter (`image_style:`),
  // defaulting to flat-vector. Shapes prompt expansion + the fallback line.
  const imageStyle = resolveImageStyle(article.frontmatter.image_style);

  // v0.4 (T3): MiniMax image path needs an LLM to rewrite the prompt.
  // Mock path passes null and skips expansion entirely.
  const expansionProvider = isMock ? null : new MiniMaxProvider();

  const outputs: string[] = [];
  const generatedImages: string[] = [];
  // Lessons recorded by `video learn` from human review of earlier
  // videos. Active ones (corroborated or high-confidence) are spliced
  // into the image prompt contract. "" in the common case.
  const wsRoot = workspaceRootFor(projectRoot);
  const learnedImageRules =
    wsRoot === null ? "" : promptRules(loadLessonStore(wsRoot), "image-prompt");
  // CS-12: the character bible is shared across films, so it lives at the
  // workspace root rather than inside a project.
  const characterRoot = characterRootFor(projectRoot);
  if (learnedImageRules !== "") {
    outputs.push(
      `image prompts: applying ${learnedImageRules.split("\n").filter((l) => l.startsWith("- ")).length} human-review lesson(s)`,
    );
  }
  // Scenes rendered by their own visual families (canvas components,
  // or already ImageBackground) never consume the generated
  // JPG — skip them so image quota is spent only where it lands on screen.
  const selfRendered = selfRenderedSceneNumbers(projectRoot);
  const emit = opts.onEvent ?? noopEmit;
  const total = article.scenes.length;

  for (let i = 0; i < article.scenes.length; i++) {
    const scene = article.scenes[i]!;
    const visual = scene.visual ?? "";
    if (!visual || visual.trim().length === 0) continue;
    if (selfRendered.has(i + 1)) continue;

    const imagePath = path.join(imageDir, `scene_${i + 1}.jpg`);
    const cacheKey = imageCacheKey({
      sceneNumber: i + 1,
      visual,
      imageStyle,
      provider: opts.provider,
      learnedDigest: rulesDigest(learnedImageRules),
      promptRevision: IMAGE_PROMPT_REVISION,
      bakeDigest: bakeDigestFor(i + 1, bakeManifest),
      width: reqWidth,
      height: reqHeight,
    });
    // G1 (v0.8): content-keyed freshness replaces existence-only caching.
    // Matching key ⇒ skip. No sidecar ⇒ legacy adoption (write the current
    // key, keep the image — upgrading must not re-spend on untouched
    // scenes). Key mismatch ⇒ inputs changed: delete the stale jpg and
    // fall through to regeneration.
    if (existsSync(imagePath)) {
      const sidecar = readImageCacheSidecar(imagePath);
      // A sidecar-less legacy image cannot be adopted when this scene bakes
      // text: the jpg on disk predates baking and its typography is unknown.
      const adoptable =
        sidecar === null && bakeDigestFor(i + 1, bakeManifest) === "";
      if (sidecar?.cacheKey === cacheKey || adoptable) {
        if (sidecar === null) writeImageCacheSidecar(imagePath, cacheKey);
        generatedImages.push(imagePath);
        continue;
      }
      await rm(imagePath, { force: true });
      outputs.push(
        `scene_${i + 1}: stale image (visual/style changed) — regenerating`,
      );
    }

    const itemLabel = `image scene_${i + 1}`;
    const itemAt = { index: i + 1, total };
    const itemT0 = Date.now();
    emit({ kind: "start", label: itemLabel, ...itemAt });
    let promptForImage = visual;
    if (expansionProvider) {
      try {
        const { prompt } = await expandScenePrompt(
          {
            id: scene.id,
            visual,
            caption: scene.caption,
            narration: scene.narration,
            // CS-12: the characters this scene cites. Their anchors are
            // spliced into the brief — the image model takes no reference
            // image, so this text is the consistency mechanism.
            ...(scene.characters !== undefined
              ? { characters: scene.characters }
              : {}),
          },
          expansionProvider,
          projectRoot,
          i + 1,
          {
            style: imageStyle,
            learned: learnedImageRules,
            // v0.10: the declared era/region/culture. Absent in older
            // articles, in which case the expander behaves exactly as before.
            setting: article.frontmatter.setting,
            characterRoot,
          },
        );
        promptForImage = prompt;
        outputs.push(
          `assets/images/scene_${i + 1}.prompt.txt (LLM-expanded, style=${imageStyle})`,
        );
      } catch (err) {
        // Fall back to the raw visual line so a provider hiccup doesn't
        // stall the whole render. The style suffix still applies — the
        // image model must see the style contract on every path.
        promptForImage = `${visual}\n${stylePromptSuffix(imageStyle)}`;
        outputs.push(
          `scene_${i + 1}: prompt expansion failed, using raw visual — ${(err as Error).message.slice(0, 60)}`,
        );
      }
    }

    try {
      const result = await heartbeat(
        itemLabel,
        () =>
          provider.generate({
            prompt: promptForImage,
            width: reqWidth,
            height: reqHeight,
          }),
        emit,
      );
      await writeFile(imagePath, result.bytes);
      writeImageCacheSidecar(imagePath, cacheKey);
      emit({
        kind: "done",
        label: itemLabel,
        ...itemAt,
        elapsedSec: elapsedSinceSec(itemT0),
      });
      outputs.push(`assets/images/scene_${i + 1}.jpg`);
      generatedImages.push(imagePath);
    } catch (err) {
      // Non-fatal: scene falls back to AnimatedIllustration.
      emit({
        kind: "fail",
        label: itemLabel,
        ...itemAt,
        elapsedSec: elapsedSinceSec(itemT0),
        message: (err as Error).message,
      });
      outputs.push(
        `scene_${i + 1}: image gen failed — ${(err as Error).message.slice(0, 60)}`,
      );
    }
  }

  if (bakeManifest) {
    const baked = await runBakeText({
      imagesDir: imageDir,
      manifest: bakeManifest,
    });
    if (baked.ok && baked.baked.length > 0) {
      outputs.push(
        `assets/images: baked text onto scene(s) ${baked.baked.join(", ")} (Pillow)`,
      );
    } else if (!baked.ok) {
      outputs.push(`bake text failed — ${baked.error ?? "unknown"}`);
    }
  }

  if (generatedImages.length > 0) {
    const switched = updateStoryboardForImages(projectRoot, generatedImages);
    outputs.push(
      `storyboard.yaml: ${switched}/${generatedImages.length} scenes switched to ImageBackground`,
    );
  }
  if ("dispose" in provider && typeof provider.dispose === "function") {
    (provider as { dispose: () => void }).dispose();
  }
  return outputs;
}

/**
 * Swap AnimatedIllustration → ImageBackground in storyboard.yaml for
 * scenes that have a generated image. Uses yaml parse/stringify (not
 * line regex) because this is a structural change, not a value tweak.
 */
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
    // CS-09: a still-first channel expresses its motion in
    // visual.props.kenBurnsScale, and this switch rewrites props from
    // scratch — dropping it here would silently restore the component's
    // 0.08 default and un-do the still-frame plan on the first make.
    const prevKenBurns =
      typeof scene.visual.props?.kenBurnsScale === "number"
        ? (scene.visual.props.kenBurnsScale as number)
        : undefined;
    scene.visual.component = "ImageBackground";
    scene.visual.props = {
      src: imagePath,
      ...(prevText !== undefined ? { caption: prevText } : {}),
      ...(prevKenBurns !== undefined ? { kenBurnsScale: prevKenBurns } : {}),
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
  /** BGM bed level while narration is silent, in dBFS below full scale.
   *  The mixer default is -18; quieter ambient beds (e.g.
   *  ambient-take-your-pick at -12.5 LUFS) sit too far under the
   *  narration at that level and land the master below -23 LUFS.
   *  Optional — omit to use the mixer default. */
  bgm_attenuation_db?: number;
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
 * than the LLM estimated (the common case — that's why sync exists).
 *
 * CS-07: the per-scene split calls the SAME `buildCaptionCues` the burn-in
 * track was compiled with, so the burned captions and this file cannot
 * disagree about where a cue starts. Scene-relative cue times are offset
 * by the accumulated runtime to give absolute SRT stamps. */
export async function writeCaptionsSrt(
  projectRoot: string,
  lang: string,
): Promise<string[]> {
  const scenes = await readSceneTimings(projectRoot);
  const srtPath = path.join(projectRoot, "captions", `${lang}.srt`);
  await mkdir(path.dirname(srtPath), { recursive: true });
  let sceneStart = 0;
  const blocks: string[] = [];
  let index = 0;
  for (const s of scenes) {
    // CS-03: the same window the burn-in uses — the scene's spoken
    // length when it holds silence, so the SRT and the burned captions
    // cannot drift apart. The opening beat (lead-in) shifts the cues
    // forward: the voice starts after it, so the text must too.
    const window = s.speechSec ?? s.duration;
    const leadIn = s.leadInSec ?? 0;
    for (const cue of buildCaptionCues(s.narration, window)) {
      index += 1;
      blocks.push(
        `${index}\n${formatSrtTime(sceneStart + leadIn + cue.startSec)} --> ${formatSrtTime(sceneStart + leadIn + cue.endSec)}\n${cue.lines.join("\n")}\n`,
      );
    }
    sceneStart += s.duration;
  }
  await writeFile(srtPath, blocks.join("\n"), "utf8");
  return [`captions/${lang}.srt`];
}

async function runTts(
  projectRoot: string,
  article: ParsedArticle,
  audioConfig: AudioConfigShape,
  opts: { fake?: boolean },
  convertMp3: (
    mp3Bytes: Uint8Array,
    minDurationSec: number,
  ) => Promise<Uint8Array> = mp3ToWav,
  onEvent: ProgressEmit = noopEmit,
): Promise<string[]> {
  const ttsProvider = article.frontmatter.tts_provider;
  const frontmatterVoice = effectiveTtsVoice(
    article.frontmatter.voice,
    article.frontmatter.language,
  );
  // Pre-flight (2026-10-18 policy): a voicebox article degrades loudly to
  // the MiniMax system voice when the local server is down, and to Edge
  // when the MiniMax key is missing too. --fake never probes localhost.
  let voiceboxHealthy = false;
  // f5tts keeps voicebox as its backup, so probe BOTH when f5tts is
  // selected — the narration chain needs voicebox health to degrade
  // correctly (f5tts → voicebox → minimax → edge).
  if (!opts.fake && (ttsProvider === "voicebox" || ttsProvider === "f5tts")) {
    voiceboxHealthy = (await voiceboxStatus()).healthy;
  }
  let f5ttsAvailable = false;
  if (!opts.fake && ttsProvider === "f5tts") {
    f5ttsAvailable = (await f5ttsStatus()).available;
  }
  const voiceboxSpeed =
    typeof article.frontmatter.tts_speed === "number"
      ? article.frontmatter.tts_speed
      : undefined;
  const voiceboxSentencePauseSec =
    typeof article.frontmatter.tts_sentence_pause_sec === "number"
      ? article.frontmatter.tts_sentence_pause_sec
      : undefined;
  const decision = resolveNarration({
    fake: opts.fake === true,
    ttsProvider,
    voice: frontmatterVoice,
    language: article.frontmatter.language,
    voiceboxHealthy,
    ...(ttsProvider === "f5tts" ? { f5ttsAvailable } : {}),
    minimaxKey: Boolean(process.env["MINIMAX_API_KEY"]),
    voiceboxSpeed,
    ttsSpeed: voiceboxSpeed,
    voiceboxSentencePauseSec,
  });
  const provider: TTSProvider = decision.provider;
  const voice = decision.voice;
  for (const w of decision.warnings) {
    console.warn(`warning: ${w}`);
  }
  const pause =
    typeof audioConfig.pause_between_sentences_sec === "number"
      ? audioConfig.pause_between_sentences_sec
      : undefined;

  const { outputs } = await synthesizeSceneAudio({
    projectRoot,
    scenes: ttsScenesFromArticle(article),
    provider,
    voice,
    language: article.frontmatter.language,
    ...(pause !== undefined ? { pauseSec: pause } : {}),
    ...(voiceboxSpeed !== undefined ? { voiceboxSpeed } : {}),
    ...(voiceboxSentencePauseSec !== undefined
      ? { voiceboxSentencePauseSec }
      : {}),
    convertMp3,
    onEvent,
  });
  return outputs;
}

/** Per-scene narration synthesis with the content-keyed TTS cache — the
 *  one loop behind both `video make`'s tts step and the `video audio`
 *  verb (one WAV-sniff, one cache, one hold-padding rule). Callers own
 *  provider selection: make resolves the voicebox/minimax degradation
 *  chain, the verb passes its Edge/Fake choice. */
export async function synthesizeSceneAudio(params: {
  projectRoot: string;
  scenes: TtsScene[];
  provider: TTSProvider;
  voice: string;
  language: string;
  pauseSec?: number;
  voiceboxSpeed?: number;
  voiceboxSentencePauseSec?: number;
  convertMp3?: (
    mp3Bytes: Uint8Array,
    minDurationSec: number,
  ) => Promise<Uint8Array>;
  onEvent?: ProgressEmit;
}): Promise<{
  outputs: string[];
  synthesized: string[];
  cached: string[];
  totalDurationMs: number;
}> {
  const convertMp3 = params.convertMp3 ?? mp3ToWav;
  const onEvent = params.onEvent ?? noopEmit;
  const audioDir = path.join(params.projectRoot, "assets", "audio");
  await mkdir(audioDir, { recursive: true });

  const outputs: string[] = [];
  const synthesized: string[] = [];
  const cached: string[] = [];
  let totalDurationMs = 0;
  const total = params.scenes.length;
  for (const [idx, scene] of params.scenes.entries()) {
    if (!scene.narration) continue; // nothing to say — keep any placeholder
    const wavPath = path.join(audioDir, `${scene.id}.wav`);
    // Cache key: the narration TEXT (hashed), voice, and pause option —
    // not file existence. An existence check silently kept stale WAVs
    // after any re-draft/narration edit, desyncing audio from the
    // picture and subtitles (the render cache uses the same
    // content-hash discipline).
    const cacheKey = ttsCacheKey(
      ttsCacheInputsFor(scene, {
        voice: params.voice,
        pauseSec: params.pauseSec,
        providerName: params.provider.name,
        language: params.language,
        voiceboxSpeed: params.voiceboxSpeed,
        voiceboxSentencePauseSec: params.voiceboxSentencePauseSec,
      }),
    );
    const meta = await readTtsMeta(wavPath);
    if (meta !== null && meta.cacheKey === cacheKey && existsSync(wavPath)) {
      cached.push(scene.id);
      continue;
    }
    const itemLabel = `tts ${scene.id}`;
    const itemAt = { index: idx + 1, total };
    const itemT0 = Date.now();
    onEvent({ kind: "start", label: itemLabel, ...itemAt });
    let result;
    try {
      result = await heartbeat(
        itemLabel,
        () =>
          params.provider.synthesize({
            text: scene.narration,
            voice: params.voice,
            language: params.language,
            ...(params.pauseSec !== undefined
              ? { pauseBetweenSentencesSec: params.pauseSec }
              : {}),
          }),
        onEvent,
      );
    } catch (err) {
      onEvent({
        kind: "fail",
        label: itemLabel,
        ...itemAt,
        elapsedSec: elapsedSinceSec(itemT0),
        message: (err as Error).message,
      });
      throw err;
    }
    onEvent({
      kind: "done",
      label: itemLabel,
      ...itemAt,
      elapsedSec: elapsedSinceSec(itemT0),
    });
    // WAV providers return RIFF bytes; everything else is MP3.
    const isWav =
      result.audio.length >= 12 &&
      result.audio[0] === 0x52 &&
      result.audio[1] === 0x49 &&
      result.audio[2] === 0x46 &&
      result.audio[3] === 0x46;
    const wavBytes = isWav
      ? result.audio
      : await convertMp3(result.audio, scene.durationSec);
    // CS-03: the scene's 留白 — silence held after the voice stops. It is
    // padded INTO the narration wav, so the measured scene length is
    // speech + hold and the still frame keeps breathing after the line
    // ends. Padding the wav (rather than the storyboard duration) keeps
    // sync-durations' job intact: it still measures, it never guesses.
    const hold = scene.holdAfterSec;
    const padded =
      hold !== undefined && hold > 0
        ? await appendSilenceToWav(wavBytes, hold)
        : wavBytes;
    // The opening beat: silence BEFORE the voice, so the title card
    // settles (and the music bed rises) before the narration starts.
    // Prepended AFTER the hold padding, so the wav reads
    // [lead-in][speech][hold].
    const leadIn = scene.leadInSec;
    const withLeadIn =
      leadIn !== undefined && leadIn > 0
        ? await prependSilenceToWav(padded, leadIn)
        : padded;
    await writeFile(wavPath, withLeadIn);
    await writeTtsMeta(wavPath, {
      cacheKey,
      synthesizedAt: new Date().toISOString(),
    });
    outputs.push(`assets/audio/${scene.id}.wav`);
    synthesized.push(scene.id);
    totalDurationMs += result.durationMs;
  }

  return { outputs, synthesized, cached, totalDurationMs };
}

/** Sidecar shape for the TTS cache (`scene_N.wav.json`). */
interface TtsCacheMeta {
  cacheKey: string;
  synthesizedAt: string;
}

/**
 * Prepend `seconds` of silence to a WAV — the opening beat.
 *
 * The bytes go through ffmpeg's `adelay`, so the result is a real WAV the
 * mixer and the renderer read unchanged; the silence sits at the FRONT of
 * the file, ahead of the voice.
 */
async function prependSilenceToWav(
  wavBytes: Uint8Array,
  seconds: number,
): Promise<Uint8Array> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const execFileAsync = promisify(execFile);
  const dir = await mkdtemp(path.join(os.tmpdir(), "video-leadin-"));
  const src = path.join(dir, "in.wav");
  const out = path.join(dir, "out.wav");
  try {
    await writeFile(src, wavBytes);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      src,
      "-af",
      `adelay=${Math.round(seconds * 1000)}:all=1`,
      "-c:a",
      "pcm_s16le",
      out,
    ]);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Append `seconds` of silence to a WAV, preserving its format (sample
 * rate, channels, sample format). The bytes go through ffmpeg, so the
 * result is a real WAV the mixer and the renderer read unchanged — a
 * held frame's silence is part of the audio track, not a gap ffmpeg has
 * to guess at later.
 */
async function appendSilenceToWav(
  wavBytes: Uint8Array,
  seconds: number,
): Promise<Uint8Array> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const execFileAsync = promisify(execFile);
  const dir = await mkdtemp(path.join(os.tmpdir(), "video-hold-"));
  const src = path.join(dir, "in.wav");
  const out = path.join(dir, "out.wav");
  try {
    await writeFile(src, wavBytes);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      src,
      "-af",
      `apad=pad_dur=${seconds}`,
      "-c:a",
      "pcm_s16le",
      out,
    ]);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
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
  const h = Math.floor(totalMs / 3_600_000)
    .toString()
    .padStart(2, "0");
  const m = (Math.floor(totalMs / 60_000) % 60).toString().padStart(2, "0");
  const s = (Math.floor(totalMs / 1000) % 60).toString().padStart(2, "0");
  const ms = (totalMs % 1000).toString().padStart(3, "0");
  return `${h}:${m}:${s},${ms}`;
}

export interface AudioAssetDirs {
  bgmDir?: string;
  sfxDir?: string;
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

  /** BGM tags are resolved, not generated: there is no music service any
   *  more. This step no longer materialises BGM at all — `runMix` resolves
   *  the tag against the curated library and hands ffmpeg the real file.
   *  Copying it here would write an mp3 under a .wav name and duplicate
   *  ~6 MB into every project. Only a legacy user-supplied `bgmDir` of
   *  .wav files is still worth staging, and that path is unchanged. */
  const materializeBgm = async (tag: string): Promise<string | null> => {
    if (!dirs.bgmDir) return null;
    const out = path.join(assetsDir, "bgm", `${tag}.wav`);
    if (existsSync(out)) return null;
    const r = await fileBased().pickBackgroundMusic({ tag });
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

/** Resolve a BGM tag to a real audio file: the project's own
 *  `assets/audio-assets/bgm/` first, then the curated library at
 *  `<repo>/assets/bgm/`. Falls back to a silent placeholder so the mix
 *  still produces an output — an unknown tag is a planning mistake, not a
 *  reason to fail the whole render.
 *
 *  `assets/brand/` is also scanned: it predates the library and holds
 *  channel-level audio a project may already reference by path.
 */
export async function resolveLibraryBgm(
  projectRoot: string,
  tag: string,
): Promise<string> {
  const wsRoot = workspaceRootFor(projectRoot);
  const dirs = [
    path.join(projectRoot, "assets", "audio-assets", "bgm"),
    ...(wsRoot
      ? [curatedBgmDirectory(wsRoot), path.join(wsRoot, "assets", "brand")]
      : []),
  ].filter((d) => existsSync(d));
  try {
    return resolveBgmTag({
      tag,
      ...(dirs[0] !== undefined ? { projectDir: dirs[0] } : {}),
      ...(dirs[1] !== undefined ? { curatedDir: dirs[1] } : {}),
    }).path;
  } catch {
    // An unresolvable tag is a planning mistake, not a reason to fail the
    // render. Write a silent placeholder so ffmpeg always receives a real
    // file — but name it `.silent.wav`: the resolver and library scans
    // skip that suffix, so the placeholder can never shadow the real
    // library again (the old `${tag}.wav` name matched the project-local
    // override path and silenced every future run for that tag).
    const placeholder = path.join(
      projectRoot,
      "assets",
      "audio-assets",
      "bgm",
      `_unresolved-${tag}.silent.wav`,
    );
    await mkdir(path.dirname(placeholder), { recursive: true });
    const r = await new MockAudioAssetProvider().pickBackgroundMusic({ tag });
    await writeFile(placeholder, r.bytes);
    const available = dirs
      .flatMap((d) => loadLocalBgmLibrary(d))
      .map((e) => e.tag);
    console.error(
      `  ! bgm tag "${tag}" not found — mixing silence. Add it to assets/bgm/,`,
    );
    console.error(
      `    or pick one of: ${available.join(", ") || "<library empty>"}`,
    );
    return placeholder;
  }
}

async function runRenderPreview(
  projectRoot: string,
  _article: ParsedArticle,
): Promise<string[]> {
  // In-process call into the shared preview operation (same one behind
  // `video preview`) — no nested CLI subprocess, no dist-path assumptions.
  const { renderPreviewProject } = await import("@video/video-renderer");
  const outcome = await renderPreviewProject(projectRoot, {
    log: (l) => console.log(l),
  });
  for (const warning of outcome.warnings) console.warn(warning);
  if (!outcome.ok) {
    for (const line of outcome.lines) console.error(line);
    throw new Error(outcome.error !== "" ? outcome.error : "preview failed");
  }
  return outcome.outputs;
}

async function runMix(
  projectRoot: string,
  config: AudioConfigShape,
): Promise<string[]> {
  // Translate audio-config.yaml → mix options: resolve tags against the
  // curated library (`assets/bgm/`) with the project's own
  // `assets/audio-assets/bgm/` shadowing it — the file is passed straight
  // to ffmpeg, NOT copied, which would write an mp3 under a .wav name
  // (the library is mp3) and duplicate ~6 MB per project.
  const mixOpts: MixProjectOptions = {};
  if (config.bgm && typeof config.bgm === "string") {
    mixOpts.bgmPath = await resolveLibraryBgm(projectRoot, config.bgm);
  }
  if (config.bgm_tracks && config.bgm_tracks.length > 0) {
    // Multi-BGM timeline (branding 2026-10-05): pre-render the ordered
    // windows into one wav, then mix it through the normal single-bgm
    // path — the ducker and master fades in the engine apply unchanged.
    const wsRoot = workspaceRootFor(projectRoot);
    const total = await totalNarrationSeconds(projectRoot);
    const windows = planBgmWindows(config.bgm_tracks, total, (track) => {
      if (!isTrackPath(track)) {
        return path.join(
          projectRoot,
          "assets",
          "audio-assets",
          "bgm",
          `${track}.wav`,
        );
      }
      // Path tracks: project-relative first, then workspace root —
      // shared brand audio lives in <ws>/assets/brand/.
      const inProject = path.resolve(projectRoot, track);
      if (existsSync(inProject)) return inProject;
      if (wsRoot && existsSync(path.resolve(wsRoot, track))) {
        return path.resolve(wsRoot, track);
      }
      return inProject; // missing → ffmpeg fails loudly downstream
    });
    const timelinePath = await renderBgmTimeline(
      windows,
      path.join(projectRoot, "assets", "audio-assets", "bgm", "_timeline.wav"),
    );
    console.log(
      `  bgm timeline: ${windows.map((w) => `${path.basename(w.path)}[${w.startSec.toFixed(1)}-${w.endSec.toFixed(1)}s]`).join(" → ")}`,
    );
    mixOpts.bgmPath = timelinePath;
  }
  if (typeof config.bgm_fade_in_sec === "number") {
    mixOpts.bgmFadeInSec = config.bgm_fade_in_sec;
  }
  if (typeof config.bgm_attenuation_db === "number") {
    mixOpts.bgmAttenuationDb = config.bgm_attenuation_db;
  }
  if (typeof config.bgm_fade_out_sec === "number") {
    mixOpts.bgmFadeOutSec = config.bgm_fade_out_sec;
  }
  // CS-15: the SFX cues live in audio-config.yaml — one of the two
  // human-edit files — but the mix engine only ever read mix.yaml, so
  // every cue declared here was silently dropped: the .wav files were
  // materialised and then never played. Pass them through explicitly.
  if (config.sfx !== undefined) {
    mixOpts.sfx = config.sfx;
  }
  // In-process call into the shared mix operation (the same one behind
  // `video mix`) — no nested CLI subprocess, no dist-path assumptions.
  const outcome = await mixProject(projectRoot, mixOpts);
  for (const warning of outcome.warnings) console.warn(`  ! ${warning}`);
  for (const line of outcome.lines) console.log(line);
  if (!outcome.ok) {
    throw new Error(outcome.error !== "" ? outcome.error : "mix failed");
  }
  return outcome.outputs;
}

/** A track value is a FILE PATH when it looks like one — contains a
 * separator or an audio extension. Everything else is a named tag. */
function isTrackPath(track: string): boolean {
  return /[\\/]/.test(track) || /\.(wav|mp3|m4a|ogg|flac)$/i.test(track);
}

/** `<anywhere>/projects/<slug>` → `<anywhere>`; null otherwise. Shared
 * branding resources (brand.yaml, assets/brand/) live at the workspace
 * root and every project references them. */
export function workspaceRootFor(projectRoot: string): string | null {
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

async function collectOutputs(projectRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const dir of [
    "assets/audio",
    "captions",
    "assets/audio-assets",
    "output",
  ]) {
    const fullDir = path.join(projectRoot, dir);
    if (!existsSync(fullDir)) continue;
    // Shallow listing only — full recursive scan adds noise to the report.
    // (This used to read a `.placeholder` file that nothing ever writes,
    // so report.outputFiles was always [].)
    try {
      for (const name of await readdir(fullDir)) {
        if (!name.startsWith(".")) out.push(`${dir}/${name}`);
      }
    } catch {
      // unreadable directory — skip it in the report
    }
  }
  return out;
}

export { MockAudioAssetProvider };
