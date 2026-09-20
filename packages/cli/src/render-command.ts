import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  formatRunId,
  readProjectState,
  writeProjectState,
  writeRun,
} from "@vf/workflow";
import { compileStoryboard } from "@vf/vdsl";
import { validateProject } from "@vf/vdsl";
import { REGISTRY } from "@vf/video-components";
import { renderPlanToVideo, faststart } from "@vf/video-renderer";
import { runValidate } from "./validate-command.js";
import type { Stage } from "@vf/workflow";

const STORYBOARD_REL = "storyboard/storyboard.yaml";

async function loadStoryboard(projectRoot: string): Promise<string> {
  const abs = path.join(projectRoot, STORYBOARD_REL);
  return readFile(abs, "utf8");
}

export async function runPreview(cwd?: string): Promise<number> {
  const root = path.resolve(cwd ?? ".");
  if (!existsSync(path.join(root, STORYBOARD_REL))) {
    console.error(`no storyboard at ${root}/${STORYBOARD_REL}`);
    return 1;
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

  const state = await readProjectState(root);
  if (state) {
    state.status = "WAITING_REVIEW";
    state.current_stage = "review";
    state.checkpoint = { id: runId, status: "WAITING_REVIEW" };
    await writeProjectState(root, state);
  }
  console.log(`✓ preview rendered: ${out}`);
  return 0;
}

export async function runFinal(cwd?: string): Promise<number> {
  const root = path.resolve(cwd ?? ".");
  const state = await readProjectState(root);
  if (!state) return 1;
  if (state.current_stage !== "review" || state.status !== "APPROVED") {
    console.error(`final: requires review checkpoint APPROVED (current: ${state.current_stage} ${state.status})`);
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

  state.status = "FINAL_APPROVED";
  state.current_stage = "final";
  state.checkpoint = { id: runId, status: "FINAL_APPROVED" };
  await writeProjectState(root, state);
  console.log(`✓ final rendered: ${out}`);
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
