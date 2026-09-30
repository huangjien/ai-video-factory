import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { resolveProjectDir, resolveProjectRoot } from "./project-path.js";
import {
  formatRunId,
  loadCheckpoint,
  readProjectState,
  transition,
  writeProjectState,
  writeRun,
  type Stage,
  type WorkflowStatus,
} from "@vf/workflow";
import { compileStoryboard } from "@vf/vdsl";
import { validateProject } from "@vf/vdsl";
import { REGISTRY } from "@vf/video-components";
import { renderPlanToVideo, faststart } from "@vf/video-renderer";
import { runValidate } from "./validate-command.js";

const STORYBOARD_REL = "storyboard/storyboard.yaml";

async function loadStoryboard(projectRoot: string): Promise<string> {
  const abs = path.join(projectRoot, STORYBOARD_REL);
  return readFile(abs, "utf8");
}

export async function runPreview(
  projectName?: string,
  cwd?: string,
  force: boolean = false,
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

  const text = await loadStoryboard(root);

  const vcode = await runValidate(path.join(root, STORYBOARD_REL), root);
  if (vcode !== 0) return vcode;

  const { renderPlan } = compileStoryboard(text, root);
  const out = path.join(root, "output", "preview.mp4");
  await renderPlanToVideo(renderPlan, out);
  const faststartOut = path.join(root, "output", "preview-faststart.mp4");
  await faststart(out, faststartOut);

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
    input_files: [STORYBOARD_REL, "vdsl/vdsl.yaml"],
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
  console.log(`✓ preview rendered: ${out}`);
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
  const text = await loadStoryboard(root);
  const { renderPlan } = compileStoryboard(text, root);
  const out = path.join(root, "output", "final.mp4");
  await renderPlanToVideo(renderPlan, out);
  const faststartOut = path.join(root, "output", "final-faststart.mp4");
  await faststart(out, faststartOut);

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
    input_files: [STORYBOARD_REL, "vdsl/vdsl.yaml"],
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
