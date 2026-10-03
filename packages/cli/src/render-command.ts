import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { resolveProjectDir, resolveProjectRoot } from "./project-path.js";
import {
  formatRunId,
  extractSceneFragment,
  hashSceneFragment,
  loadCheckpoint,
  readProjectState,
  recordSceneVersion,
  transition,
  writeProjectState,
  writeRun,
  type Stage,
  type WorkflowStatus,
} from "@vf/workflow";
import {
  compileStoryboard,
  validateProject,
  type CompileOptions,
  type RenderPlan,
} from "@vf/vdsl";
import { syncSceneDurations } from "@vf/media";
import { REGISTRY } from "@vf/video-components";
import {
  concatScenes,
  faststart,
  renderPlanToVideo,
  renderSceneToVideo,
} from "@vf/video-renderer";
import { runValidate } from "./validate-command.js";

const STORYBOARD_REL = "storyboard/storyboard.yaml";
const VDSL_REL = "vdsl/vdsl.yaml";

/** Draft quality (plan §27): same composition, 960x540@15 — iteration on
 * composition/motion does not need 1080p30 render minutes. */
const DRAFT_COMPILE: CompileOptions = { fps: 15, width: 960, height: 540 };

async function loadStoryboard(projectRoot: string): Promise<string> {
  const abs = path.join(projectRoot, STORYBOARD_REL);
  return readFile(abs, "utf8");
}

async function mtimeOrZero(p: string): Promise<number> {
  try {
    return (await stat(p)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Compile the storyboard into a RenderPlan, honoring the documented
 * contract that the renderer reads the COMPILED vdsl.yaml (plan §6):
 *
 * - vdsl.yaml missing or older than storyboard.yaml → compile from the
 *   storyboard and persist vdsl.yaml (the write the v0.1 code never did).
 * - vdsl.yaml fresh → compile FROM vdsl.yaml (normalized, deterministic).
 *
 * Before compiling, measured TTS lengths are synced into the storyboard
 * durations (`syncSceneDurations`): narration longer than the scene is
 * the normal case (the LLM underestimates), and validation hard-fails
 * audio longer than its scene.
 */
/** Compile the storyboard into a RenderPlan, honoring the documented
 * contract that the renderer reads the COMPILED vdsl.yaml (plan §6):
 *
 * - vdsl.yaml missing or older than storyboard.yaml → compile from the
 *   storyboard and persist vdsl.yaml (the write the v0.1 code never did).
 * - vdsl.yaml fresh → compile FROM vdsl.yaml (normalized, deterministic).
 *
 * Before compiling, measured TTS lengths are synced into the storyboard
 * durations (`syncSceneDurations`): narration longer than the scene is
 * the normal case (the LLM underestimates), and validation hard-fails
 * audio longer than its scene.
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
  const text = await loadStoryboard(root);

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
    return { renderPlan, storyboardText: text, compiledFromVdsl };
  } catch (err) {
    if (!compiledFromVdsl) throw err;
    console.error(
      `warn: ${VDSL_REL} unusable (${(err as Error).message.split("\n")[0]}) — recompiling from storyboard`,
    );
    const { renderPlan, write } = compileStoryboard(text, root, compileOpts);
    await write();
    return { renderPlan, storyboardText: text, compiledFromVdsl: false };
  }
}

/** Per-scene cache file name: index-prefixed (stable concat order) with a
 * filesystem-safe slug of the scene id. */
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
  audioPath?: string;
  audioMtimeMs?: number;
  renderedAt: string;
}

/** Cache freshness: the scene fragment, the narration audio, AND every
 * project-level render input (theme, fps/width/height) must match. A
 * style.theme flip leaves all fragment hashes identical — without the
 * projectHash term it silently reused the old-theme MP4s. */
export function sceneCacheIsFresh(
  meta: SceneCacheMeta | null,
  sceneHash: string | null,
  projectHash: string,
  audioPath: string | null,
  audioMtimeMs: number,
): boolean {
  return (
    meta !== null &&
    sceneHash !== null &&
    meta.sceneHash === sceneHash &&
    meta.projectHash === projectHash &&
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

export interface PreviewOptions {
  draft?: boolean | undefined;
}

export async function runPreview(
  projectName?: string,
  cwd?: string,
  force: boolean = false,
  opts: PreviewOptions = {},
): Promise<number> {
  // Two ways to identify the project:
  //   1. `projectName` (slug or human name) → look under `${cwd ?? "."}/projects/<slug>`
  //   2. neither → auto-discover from `${cwd ?? "."}/projects/*` via resolveProjectRoot
  let root: string;
  if (projectName) {
    const resolved = resolveProjectDir(projectName, cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return 1;
    }
    root = resolved.root;
  } else {
    const resolved = resolveProjectRoot(cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return 1;
    }
    root = resolved.root;
  }
  if (!existsSync(path.join(root, STORYBOARD_REL))) {
    console.error(`no storyboard at ${root}/${STORYBOARD_REL}`);
    return 1;
  }

  // Human gate (doc §58: never auto-approve). Rendering is not allowed
  // until the storyboard stage carries an approved checkpoint; --force is
  // the explicit emergency bypass and is recorded as such.
  const state = await readProjectState(root);
  if (!state) {
    console.error(
      `preview: no project state at ${root}/state.yaml — run \`vf new\` first`,
    );
    return 1;
  }
  if (state.status === "FINAL_APPROVED") {
    console.error(
      `preview: project is FINAL_APPROVED (terminal) — run \`vf reset --force\` to rework it`,
    );
    return 1;
  }
  const storyboardCp = await loadCheckpoint(root, "storyboard");
  if (storyboardCp?.status !== "approved" && !force) {
    console.error(
      `preview: storyboard is not approved yet — read ${path.join(root, "storyboard", "storyboard.yaml")} (make flow: article.md), then run:`,
    );
    console.error(`  vf approve storyboard --cwd ${path.dirname(root)}`);
    console.error(`or skip the gate with: vf preview --force`);
    return 1;
  }
  if (force && storyboardCp?.status !== "approved") {
    console.warn(`[FORCE] rendering without an approved storyboard`);
  }

  const draft = opts.draft === true;
  const { renderPlan, storyboardText } = await loadOrCompileStoryboard(
    root,
    draft ? DRAFT_COMPILE : {},
  );

  const vcode = await runValidate(path.join(root, STORYBOARD_REL), root);
  if (vcode !== 0) return vcode;

  // Version recording (plan §26): every scene whose fragment differs from
  // its latest stored version gets a new one — human edits included, with
  // no extra command to remember.
  for (const scene of renderPlan.scenes) {
    const frag = extractSceneFragment(storyboardText, scene.id);
    if (frag === null) continue;
    const version = await recordSceneVersion(root, scene.id, frag);
    if (version !== null) {
      console.log(`  scene ${scene.id}: recorded version v${version}`);
    }
  }

  // Scene-isolated incremental render (plan Principle 1): reuse any scene
  // mp4 whose CONTENT hash matches the current storyboard fragment and
  // whose narration audio is unchanged — editing scene-007 re-renders only
  // scene-007, regardless of mtimes elsewhere in the file. projectHash
  // covers render inputs OUTSIDE the fragments (theme, geometry).
  const scenesDir = path.join(root, draft ? "scenes-draft" : "scenes");
  const projectHash = hashSceneFragment(
    JSON.stringify({
      project: renderPlan.project,
      style: renderPlan.style,
    }),
  );
  const sceneFiles: string[] = [];
  for (const scene of renderPlan.scenes) {
    const file = path.join(scenesDir, sceneFileName(scene.index, scene.id));
    sceneFiles.push(file);
    const frag = extractSceneFragment(storyboardText, scene.id);
    const sceneHash = frag === null ? null : hashSceneFragment(frag);
    const audioPath = scene.audio ? path.join(root, scene.audio) : null;
    const audioM = audioPath ? await mtimeOrZero(audioPath) : 0;
    const sidecar = await readSceneCacheMeta(file);
    if (sceneCacheIsFresh(sidecar, sceneHash, projectHash, audioPath, audioM)) {
      console.log(`  scene ${scene.id}: cached`);
      continue;
    }
    console.log(`  scene ${scene.id}: rendering`);
    await renderSceneToVideo(renderPlan, scene.id, file);
    await writeSceneCacheMeta(file, {
      sceneHash: sceneHash ?? "",
      projectHash,
      ...(audioPath !== null ? { audioPath, audioMtimeMs: audioM } : {}),
      renderedAt: new Date().toISOString(),
    });
  }

  const out = path.join(root, "output", "preview.mp4");
  await concatScenes(sceneFiles, out);
  const faststartOut = path.join(root, "output", "preview-faststart.mp4");
  await faststart(out, faststartOut);

  // QA groundwork (plan §28/T3.3): render report + contact sheet after
  // every preview. Findings are surfaced, not fatal — the export gate
  // that hard-fails on QA errors lands in T6.2.
  try {
    const { writeQaArtifacts } = await import("@vf/qa");
    const report = await writeQaArtifacts(root, renderPlan, out);
    const errors = report.findings.filter((f) => f.level === "error");
    const warns = report.findings.filter((f) => f.level === "warn");
    if (report.findings.length > 0) {
      console.log(
        `  QA: ${report.ok ? "ok" : "FAILED"} — ${errors.length} error(s), ${warns.length} warning(s) → qa/render-report.json`,
      );
      for (const f of report.findings) {
        console.log(`    [${f.level}] ${f.message}`);
      }
    } else {
      console.log(`  QA: all checks passed → qa/render-report.json`);
    }
  } catch (err) {
    console.error(`  QA: tooling failed (video is still valid): ${(err as Error).message}`);
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
    // Honest input list: vdsl.yaml is only an input when it exists (it is
    // written by loadOrCompileStoryboard on every non-draft compile).
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
  console.log(`✓ preview rendered: ${out}${draft ? " (draft 960x540@15)" : ""}`);
  return 0;
}

export interface FinalOptions {
  cwd?: string;
  /** Project name (slug). When given, the project root is resolved as
   * `${cwd ?? "."}/projects/<slug>`. Mutually convenient with the project
   * positional arg on the CLI; cwd overrides it when both are present. */
  projectName?: string;
  /** When true, after rendering the bare mp4, run `vf mix` to replace
   * `output/final-mixed.mp4` as the published artifact (narrration + BGM + SFX
   * cues per audio-assets/mix.yaml). */
  mix?: boolean;
  /** Bypass the QA gate (T6.2): render even when error-level QA findings
   * are present. Printed as [FORCE] and the failed gate stays in the run
   * history. */
  force?: boolean;
}

export async function runFinal(
  opts: FinalOptions | string = {},
): Promise<number> {
  // Back-compat: accept either a cwd string or an options object.
  const resolved: FinalOptions =
    typeof opts === "string" ? { cwd: opts } : opts;
  const projectResolved = resolveProjectRoot(resolved.cwd);
  if (!projectResolved.ok) {
    console.error(projectResolved.message);
    return 1;
  }
  const root = projectResolved.root;
  const state = await readProjectState(root);
  if (!state) return 1;
  if (state.current_stage !== "review" || state.status !== "APPROVED") {
    console.error(
      `final: requires review checkpoint APPROVED (current: ${state.current_stage} ${state.status})`,
    );
    return 1;
  }
  const { renderPlan } = await loadOrCompileStoryboard(root);

  // QA gate (T6.2, §24/Principle 7): the final render IS the export path.
  // Error-level findings against the preview artifact block it; --force is
  // the explicit bypass. Warn-level findings surface but don't block.
  const force = resolved.force === true;
  const qaVideo = [
    path.join(root, "output", "preview-faststart.mp4"),
    path.join(root, "output", "preview.mp4"),
  ].find((p) => existsSync(p));
  if (!qaVideo && !force) {
    console.error(
      `final: no preview artifact to QA — run \`vf preview\` first (or --force to render un-QA'd)`,
    );
    return 1;
  }
  if (qaVideo) {
    const { writeQaArtifacts } = await import("@vf/qa");
    const report = await writeQaArtifacts(root, renderPlan, qaVideo);
    const errors = report.findings.filter((f) => f.level === "error");
    if (!report.ok) {
      for (const f of report.findings) {
        console.error(`  [${f.level}] ${f.check}: ${f.message}`);
        if (f.fix) console.error(`         fix: ${f.fix}`);
      }
    }
    if (errors.length > 0 && !force) {
      const runId = formatRunId("final");
      await writeRun(root, {
        run_id: runId,
        stage: "final" as Stage,
        status: "failed",
        actor: "tool",
        tool: "qa-gate",
        input_commit: safeGitHead(root),
        input_files: [STORYBOARD_REL],
        output_files: [],
        created_at: new Date().toISOString(),
        duration_ms: 0,
        error: `qa-gate: ${errors.length} error-level finding(s) — see qa/render-report.json`,
      });
      console.error(
        `final: blocked by the QA gate (${errors.length} error(s)) — fix and re-run, or \`vf final --force\` to override`,
      );
      return 1;
    }
    if (errors.length > 0 && force) {
      console.warn(`[FORCE] rendering final despite ${errors.length} QA error(s)`);
    }
  }

  const out = path.join(root, "output", "final.mp4");
  await renderPlanToVideo(renderPlan, out);
  const faststartOut = path.join(root, "output", "final-faststart.mp4");
  await faststart(out, faststartOut);

  // Refresh QA artifacts against the shipped final (non-blocking — the
  // gate already ran pre-render).
  try {
    const { writeQaArtifacts: writeFinalQa } = await import("@vf/qa");
    await writeFinalQa(root, renderPlan, out);
  } catch (err) {
    console.error(`  QA refresh failed (final is still valid): ${(err as Error).message}`);
  }

  const runId = formatRunId("final");
  const start = Date.now();
  await writeRun(root, {
    run_id: runId,
    stage: "final" as Stage,
    status: "succeeded",
    actor: "tool",
    tool: "remotion",
    tool_version: "4.0.526",
    input_commit: safeGitHead(root),
    input_files: [
      STORYBOARD_REL,
      ...(existsSync(path.join(root, VDSL_REL)) ? [VDSL_REL] : []),
    ],
    output_files: ["output/final.mp4", "output/final-faststart.mp4"],
    created_at: new Date().toISOString(),
    duration_ms: Date.now() - start,
  });

  // APPROVED → FINAL_APPROVED via the machine (the precondition above
  // guarantees APPROVED, so this cannot throw — kept defensive anyway).
  let finalStatus: WorkflowStatus;
  try {
    const next = transition(
      { status: state.status, stage: state.current_stage },
      { kind: "final_approve" },
      { run_id: runId, actor: "tool" },
    );
    finalStatus = next.state.status;
  } catch (err) {
    console.error(`final: ${(err as Error).message}`);
    return 1;
  }
  state.status = finalStatus;
  state.current_stage = "final";
  state.checkpoint = { id: runId, status: finalStatus };
  await writeProjectState(root, state);
  console.log(`✓ final rendered: ${faststartOut}`);
  if (resolved.mix) {
    try {
      const { runMix } = await import("./mix-command.js");
      const mixCode = await runMix({ project: path.basename(root), cwd: root });
      if (mixCode !== 0) {
        console.error(
          `final: mix step exited ${mixCode}; bare narration mp4 is still at output/final-faststart.mp4`,
        );
        return mixCode;
      }
      console.log(
        `  audio: final-mixed.mp4 replaces narration-only mp4 as the published artifact`,
      );
    } catch (err) {
      console.error(`final: mix step threw:`, (err as Error).message);
      return 1;
    }
  }
  return 0;
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

// Re-export for convenience
export { validateProject, REGISTRY };
