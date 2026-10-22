import { existsSync, readFileSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  brandSchema,
  compileStoryboard,
  formatErrors,
  validateProject,
  type CompileOptions,
  type RenderPlan,
} from "@video/vdsl";
import { syncSceneDurations, probeAudioDuration } from "@video/media";
import { sharedBrowser } from "./browser.js";
import { REGISTRY } from "@video/video-components";
import {
  extractSceneFragment,
  formatRunId,
  hashSceneFragment,
  loadCheckpoint,
  readProjectState,
  recordSceneVersion,
  transition,
  writeProjectState,
  writeRun,
  type Stage,
} from "@video/workflow";
import {
  concatScenes,
  faststart,
  renderSceneToVideo,
  resolveImageSources,
} from "./render.js";

const STORYBOARD_REL = "storyboard/storyboard.yaml";
const VDSL_REL = "vdsl/vdsl.yaml";

/** Draft quality (plan §27): same composition, 960x540@15 — iteration on
 *  composition/motion does not need 1080p30 render minutes. */
const DRAFT_COMPILE: CompileOptions = { fps: 15, width: 960, height: 540 };

async function mtimeOrZero(p: string): Promise<number> {
  try {
    return (await stat(p)).mtimeMs;
  } catch {
    return 0;
  }
}

/** Compile the storyboard into a RenderPlan, honoring the documented
 *  contract that the renderer reads the COMPILED vdsl.yaml (plan §6):
 *
 *  - vdsl.yaml missing or older than storyboard.yaml → compile from the
 *    storyboard and persist vdsl.yaml (the write the v0.1 code never did).
 *  - vdsl.yaml fresh → compile FROM vdsl.yaml (normalized, deterministic).
 *
 *  Before compiling, measured TTS lengths are synced into the storyboard
 *  durations (`syncSceneDurations`): narration longer than the scene is
 *  the normal case (the LLM underestimates), and validation hard-fails
 *  audio longer than its scene.
 */
export async function loadOrCompileStoryboard(
  root: string,
  compileOpts: CompileOptions = {},
): Promise<{
  renderPlan: RenderPlan;
  storyboardText: string;
  compiledFromVdsl: boolean;
}> {
  await syncSceneDurations(root);
  const storyboardPath = path.join(root, STORYBOARD_REL);
  const vdslPath = path.join(root, VDSL_REL);
  const text = await readFile(storyboardPath, "utf8");

  let source = text;
  let compiledFromVdsl = false;
  if (existsSync(vdslPath)) {
    const [vdslM, sbM] = await Promise.all([
      mtimeOrZero(vdslPath),
      mtimeOrZero(storyboardPath),
    ]);
    if (vdslM >= sbM) {
      source = await readFile(vdslPath, "utf8");
      compiledFromVdsl = true;
    }
  }

  // A corrupt/stub vdsl.yaml must never block rendering: fall back to the
  // storyboard and rewrite the compiled artifact.
  try {
    const { renderPlan, write } = compileStoryboard(source, root, compileOpts);
    if (!compiledFromVdsl) await write();
    await mergeBrandConfig(renderPlan, root);
    return { renderPlan, storyboardText: text, compiledFromVdsl };
  } catch (err) {
    if (!compiledFromVdsl) throw err;
    const { renderPlan, write } = compileStoryboard(text, root, compileOpts);
    await write();
    await mergeBrandConfig(renderPlan, root);
    return { renderPlan, storyboardText: text, compiledFromVdsl: false };
  }
}

/** Branding resources live at the WORKSPACE root (`<ws>/brand.yaml`,
 *  `<ws>/assets/brand/*`) and every project inherits them; a project-level
 *  `brand.yaml` overrides per top-level key (a project `intro:` replaces
 *  the root `intro:` wholesale). Icon paths resolve relative to the brand
 *  file that declared them and are stored absolute, so the renderer's
 *  data-URL inlining works regardless of process CWD. */
export async function mergeBrandConfig(
  renderPlan: RenderPlan,
  root: string,
): Promise<void> {
  const wsRoot = workspaceRootFor(root);
  const sources: { dir: string; file: string }[] = [];
  if (wsRoot)
    sources.push({ dir: wsRoot, file: path.join(wsRoot, "brand.yaml") });
  sources.push({ dir: root, file: path.join(root, "brand.yaml") });

  let merged: Record<string, unknown> = {};
  let iconBase: string | null = null;
  let loadedAny = false;
  for (const { dir, file } of sources) {
    if (!existsSync(file)) continue;
    const parsed = parseBrandFile(file);
    if (!parsed) continue;
    loadedAny = true;
    merged = { ...merged, ...parsed.block };
    if (parsed.block.icon !== undefined) iconBase = dir;
  }
  if (!loadedAny) return;

  if (iconBase && typeof merged.icon === "string" && merged.icon.length > 0) {
    merged.icon = path.resolve(iconBase, merged.icon);
  }
  const parsed = brandSchema.safeParse(merged);
  if (!parsed.success) {
    console.error(
      `warn: merged brand config invalid — ignored (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")})`,
    );
    return;
  }
  renderPlan.style.brand = parsed.data;
}

/** `<anywhere>/projects/<slug>` → `<anywhere>`; null otherwise. */
function workspaceRootFor(projectRoot: string): string | null {
  const parentDir = path.dirname(projectRoot);
  if (path.basename(parentDir) === "projects") {
    return path.dirname(parentDir);
  }
  return null;
}

/** Parse + normalize one brand.yaml. Returns null (with a warning) when
 *  unparsable. Accepts both `brand: {...}` and a bare brand block. */
function parseBrandFile(
  file: string,
): { block: Record<string, unknown> } | null {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(
      `warn: ${file} unparsable — ignored (${(err as Error).message.split("\n")[0]})`,
    );
    return null;
  }
  if (
    raw &&
    typeof raw === "object" &&
    "brand" in raw &&
    (raw as Record<string, unknown>).brand &&
    typeof (raw as Record<string, unknown>).brand === "object"
  ) {
    return {
      block: {
        ...((raw as Record<string, unknown>).brand as Record<string, unknown>),
      },
    };
  }
  return raw && typeof raw === "object"
    ? { block: { ...(raw as Record<string, unknown>) } }
    : null;
}

/** Per-scene cache file name: index-prefixed (stable concat order) with a
 *  filesystem-safe slug of the scene id. */
function sceneFileName(index: number, id: string): string {
  const slug = id.replace(/[^a-zA-Z0-9_-]+/g, "_") || "scene";
  return `${String(index).padStart(2, "0")}-${slug}.mp4`;
}

interface SceneCacheMeta {
  sceneHash: string;
  /** Hash of project-level render inputs (style.theme + project geometry).
   * Absent on sidecars written before this field existed — treated as a
   * mismatch so legacy caches invalidate exactly once. */
  projectHash?: string;
  /** Hash of the scene's COMPILED caption lines. The storyboard fragment
   * cannot see wrapText output: a change to @video/media's wrapText or the
   * compile-time caption width alters the burned-in lines while every
   * fragment hash stays identical. Absent on legacy sidecars — mismatch. */
  captionsHash?: string;
  /** `RENDERER_REVISION` that produced these pixels. Explicit rather than
   * folded into `projectHash` so `video make --dry-run` can check it with a
   * string compare — the dry-run has no compiled renderPlan and must not
   * reconstruct one just to answer "will this re-render?". */
  rendererRevision?: string;
  audioPath?: string;
  audioMtimeMs?: number;
  renderedAt: string;
}

/**
 * Identity of the renderer build, recorded in every scene cache sidecar.
 *
 * The cache decides freshness from the storyboard fragment, the project
 * inputs, and the audio. None of those move when the RENDERER changes —
 * editing a component's colour, type size, or layout leaves all three
 * identical, so every cached scene mp4 is replayed with the old pixels.
 * That is not hypothetical: changing the caption treatment on 2026-10-17
 * left all 59 cached scene mp4s across the four shipped projects matching,
 * i.e. the change was invisible in any re-render.
 *
 * Bump this whenever a change under `video-renderer/src` or
 * `video-components/src` alters what a frame looks like. It does NOT need
 * bumping for refactors with identical output — an unnecessary bump
 * re-renders every scene, which is expensive.
 *
 * Frame-affecting inputs also live OUTSIDE those two directories: the
 * compiled caption lines come from @video/media's `wrapText` and the vdsl
 * compiler (compile.ts). Caption-content changes are covered by the
 * sidecar's `captionsHash`, but a wrapText/compile change that alters
 * frames in other ways (timing, geometry) still requires a revision bump.
 *
 * Same contract as `IMAGE_PROMPT_REVISION` in @video/draft, and deliberately
 * manual: hashing the source tree would re-render on every comment edit.
 */
export const RENDERER_REVISION = "7";
// 2: caption type + halo + no-plate overlay
// 3: the title card preserves inter-word spaces — each glyph is its own flex
// item, so a bare space collapsed to zero width and headlines rendered run-on.
// 4: ImageBackground's caption band now shares captionStyle.ts geometry
// (bottom offset, max-width, padding) with the CaptionsOverlay track and
// drops the title-face override — image-scene captions moved.
// 5: ImageBackground's veil is bottom-weighted (was a 0.45→0.65 full-frame
// wash, which cost a paper-white ground half its luma), the img no longer
// fades in, and `kenBurnsScale: 0` now freezes the opacity ramps too.
// 6: captions are timed cues — the overlay draws only the cue active at the
// current frame, so a scene's narration can no longer stack past two rows.
// 7: the per-scene corner watermark honours `brand.watermark: false`, so a
// project can drop the inherited mark without dropping the rest of the brand.

/** Cache freshness: the scene fragment, the narration audio, AND every
 * project-level render input (theme, fps/width/height) must match. A
 * style.theme flip leaves all fragment hashes identical — without the
 * projectHash term it silently reused the old-theme MP4s. `captionsHash`
 * (compiled caption lines) is optional: the renderer always passes it;
 * callers without a compiled plan (video make --dry-run) omit it and the
 * term is skipped rather than falsely stale. */
export function sceneCacheIsFresh(
  meta: SceneCacheMeta | null,
  sceneHash: string | null,
  projectHash: string,
  audioPath: string | null,
  audioMtimeMs: number,
  rendererRevision: string = RENDERER_REVISION,
  captionsHash: string | null = null,
): boolean {
  return (
    meta !== null &&
    sceneHash !== null &&
    meta.sceneHash === sceneHash &&
    meta.projectHash === projectHash &&
    // Absent on sidecars written before the field existed — a mismatch,
    // so pre-existing caches invalidate exactly once.
    meta.rendererRevision === rendererRevision &&
    (captionsHash === null || meta.captionsHash === captionsHash) &&
    (meta.audioPath ?? null) === (audioPath ?? null) &&
    Math.abs((meta.audioMtimeMs ?? 0) - audioMtimeMs) < 1
  );
}

async function readSceneCacheMeta(
  file: string,
): Promise<SceneCacheMeta | null> {
  try {
    return JSON.parse(await readFile(`${file}.json`, "utf8")) as SceneCacheMeta;
  } catch {
    return null;
  }
}

async function writeSceneCacheMeta(
  file: string,
  meta: SceneCacheMeta,
): Promise<void> {
  await writeFile(`${file}.json`, JSON.stringify(meta, null, 2), "utf8");
}

export interface IncrementalRenderResult {
  /** Scene mp4s in concat order. */
  sceneFiles: string[];
  cachedSceneIds: string[];
  renderedSceneIds: string[];
}

/** Scene-isolated incremental render (plan Principle 1): reuse any scene
 *  mp4 whose CONTENT hash matches the current storyboard fragment and
 *  whose narration audio is unchanged — editing scene-007 re-renders only
 *  scene-007, regardless of mtimes elsewhere in the file. projectHash
 *  covers render inputs OUTSIDE the fragments (theme, geometry). */
async function renderScenesIncrementally(
  renderPlan: RenderPlan,
  storyboardText: string,
  root: string,
  opts: { draft?: boolean; log?: (line: string) => void } = {},
): Promise<IncrementalRenderResult> {
  const log = opts.log ?? (() => {});
  const scenesDir = path.join(
    root,
    opts.draft === true ? "scenes-draft" : "scenes",
  );
  const projectHash = hashSceneFragment(
    JSON.stringify({
      project: renderPlan.project,
      style: renderPlan.style,
    }),
  );
  const result: IncrementalRenderResult = {
    sceneFiles: [],
    cachedSceneIds: [],
    renderedSceneIds: [],
  };
  for (const scene of renderPlan.scenes) {
    const file = path.join(scenesDir, sceneFileName(scene.index, scene.id));
    result.sceneFiles.push(file);
    const frag = extractSceneFragment(storyboardText, scene.id);
    const sceneHash = frag === null ? null : hashSceneFragment(frag);
    // Compiled caption cues are a render input the fragment cannot see
    // (split + wrap run at compile time) — fold them into the sidecar so a
    // cue/width change regenerates the scene instead of replaying old
    // pixels. The whole cue array is hashed, not just the text: CS-07 made
    // the times part of the output, so a retimed cue must invalidate too.
    const captionsHash =
      scene.captions === null
        ? null
        : hashSceneFragment(JSON.stringify(scene.captions.cues));
    const audioPath = scene.audio ? path.join(root, scene.audio) : null;
    const audioM = audioPath ? await mtimeOrZero(audioPath) : 0;
    const sidecar = await readSceneCacheMeta(file);
    if (
      sceneCacheIsFresh(
        sidecar,
        sceneHash,
        projectHash,
        audioPath,
        audioM,
        RENDERER_REVISION,
        captionsHash,
      )
    ) {
      log(`  scene ${scene.id}: cached`);
      result.cachedSceneIds.push(scene.id);
      continue;
    }
    log(`  scene ${scene.id}: rendering`);
    await renderSceneToVideo(renderPlan, scene.id, file);
    await writeSceneCacheMeta(file, {
      sceneHash: sceneHash ?? "",
      projectHash,
      ...(captionsHash !== null ? { captionsHash } : {}),
      rendererRevision: RENDERER_REVISION,
      ...(audioPath !== null ? { audioPath, audioMtimeMs: audioM } : {}),
      renderedAt: new Date().toISOString(),
    });
    result.renderedSceneIds.push(scene.id);
  }
  return result;
}

export interface PreviewOutcome {
  ok: boolean;
  /** Progress + result lines, already formatted for the user. */
  lines: string[];
  /** e.g. "[FORCE] rendering without an approved storyboard". */
  warnings: string[];
  /** Fatal message when ok is false (empty string for silent failures). */
  error: string;
  /** Files written on success (project-relative). */
  outputs: string[];
}

/** The full preview operation behind one interface: human gate, compile,
 *  validation, scene versioning, incremental scene render, concat,
 *  faststart, QA report, run record, and the state-machine transition.
 *  Both `video preview` (CLI) and `video make`'s render step call this —
 *  in-process, no nested CLI subprocess. */
export async function renderPreviewProject(
  root: string,
  opts: { draft?: boolean; force?: boolean; log?: (line: string) => void } = {},
): Promise<PreviewOutcome> {
  const log = opts.log ?? (() => {});
  const fail = (error: string, lines: string[] = []): PreviewOutcome => ({
    ok: false,
    lines,
    warnings: [],
    error,
    outputs: [],
  });
  const draft = opts.draft === true;
  const force = opts.force === true;

  if (!existsSync(path.join(root, STORYBOARD_REL))) {
    return fail(`no storyboard at ${root}/${STORYBOARD_REL}`);
  }
  const state = await readProjectState(root);
  if (!state) {
    return fail(
      `preview: no project state at ${root}/state.yaml — run \`video new\` first`,
    );
  }
  if (state.status === "FINAL_APPROVED") {
    return fail(
      `preview: project is FINAL_APPROVED (terminal) — run \`video reset --force\` to rework it`,
    );
  }
  const storyboardCp = await loadCheckpoint(root, "storyboard");
  const warnings: string[] = [];
  if (storyboardCp?.status !== "approved" && !force) {
    return fail("", [
      `preview: storyboard is not approved yet — read ${path.join(root, "storyboard", "storyboard.yaml")} (make flow: article.md), then run:`,
      `  video approve storyboard --cwd ${path.dirname(root)}`,
      `or skip the gate with: video preview --force`,
    ]);
  }
  if (force && storyboardCp?.status !== "approved") {
    warnings.push(`[FORCE] rendering without an approved storyboard`);
  }

  const { renderPlan, storyboardText } = await loadOrCompileStoryboard(
    root,
    draft ? DRAFT_COMPILE : {},
  );

  const validation = await validateProject(
    storyboardText,
    path.basename(STORYBOARD_REL),
    { projectRoot: root, registry: REGISTRY, probeAudio: probeAudioDuration },
  );
  if (!validation.ok) {
    return fail(formatErrors(validation.errors));
  }

  // Version recording (plan §26): every scene whose fragment differs from
  // its latest stored version gets a new one — human edits included, with
  // no extra command to remember.
  for (const scene of renderPlan.scenes) {
    const frag = extractSceneFragment(storyboardText, scene.id);
    if (frag === null) continue;
    const version = await recordSceneVersion(root, scene.id, frag);
    if (version !== null) {
      log(`  scene ${scene.id}: recorded version v${version}`);
    }
  }

  // Surface missing image assets as warnings instead of silent dark
  // backgrounds / skipped watermarks (resolveImageSources keeps its
  // defensive fallback either way). Runs once up front; the per-scene
  // re-resolution inside renderSceneToVideo then no-ops on data URLs.
  const resolvedPlan = await resolveImageSources(renderPlan, (message) => {
    warnings.push(message);
    log(`  warn: ${message}`);
  });

  let sceneFiles: string[];
  try {
    ({ sceneFiles } = await renderScenesIncrementally(
      resolvedPlan,
      storyboardText,
      root,
      { ...(draft ? { draft: true } : {}), log },
    ));
  } finally {
    // The shared Chrome lives for the whole scene batch and is closed
    // when the batch ends — Remotion spawns it detached, so leaving it
    // open would strand the process after the CLI exits.
    await sharedBrowser.close();
  }

  const out = path.join(root, "output", "preview.mp4");
  await concatScenes(sceneFiles, out);
  const faststartOut = path.join(root, "output", "preview-faststart.mp4");
  await faststart(out, faststartOut);

  // QA groundwork (plan §28/T3.3): render report + contact sheet after
  // every preview. Findings are surfaced, not fatal — the export gate
  // that hard-fails on QA errors lands in T6.2.
  try {
    const { writeQaArtifacts } = await import("@video/qa");
    const report = await writeQaArtifacts(root, renderPlan, out);
    const errors = report.findings.filter((f) => f.level === "error");
    const warns = report.findings.filter((f) => f.level === "warn");
    if (report.findings.length > 0) {
      log(
        `  QA: ${report.ok ? "ok" : "FAILED"} — ${errors.length} error(s), ${warns.length} warning(s) → qa/render-report.json`,
      );
      for (const f of report.findings) {
        log(`    [${f.level}] ${f.message}`);
      }
    } else {
      log(`  QA: all checks passed → qa/render-report.json`);
    }
  } catch (err) {
    log(
      `  QA: tooling failed (video is still valid): ${(err as Error).message}`,
    );
  }

  const runId = formatRunId("render");
  const start = Date.now();
  await writeRun(root, {
    run_id: runId,
    stage: "render" as Stage,
    status: "succeeded",
    actor: "tool",
    tool: "remotion",
    tool_version: "4.0.526",
    input_commit: safeGitHead(root),
    input_files: [
      STORYBOARD_REL,
      ...(existsSync(path.join(root, VDSL_REL)) ? [VDSL_REL] : []),
    ],
    output_files: ["output/preview.mp4", "output/preview-faststart.mp4"],
    created_at: new Date().toISOString(),
    duration_ms: Date.now() - start,
  });

  // Route the status change through the state machine: APPROVED →
  // WAITING_REVIEW (first render), WAITING_REVIEW → WAITING_REVIEW
  // (re-render), or any non-terminal state → WAITING_REVIEW under --force.
  const next = transition(
    { status: state.status, stage: state.current_stage },
    { kind: "preview", ...(force ? { force: true } : {}) },
    { run_id: runId, actor: "tool" },
  );
  state.status = next.state.status;
  state.current_stage = "review";
  state.checkpoint = { id: runId, status: next.state.status };
  await writeProjectState(root, state);
  return {
    ok: true,
    lines: [`✓ preview rendered: ${out}${draft ? " (draft 960x540@15)" : ""}`],
    warnings,
    error: "",
    outputs: ["output/preview.mp4", "output/preview-faststart.mp4"],
  };
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
