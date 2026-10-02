import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatRunId, writeRun } from "@vf/workflow";
import {
  ExcalidrawSpecSchema,
  svgSpecToAnimatedSvg,
  svgSpecToExcalidraw,
  type ExcalidrawSpec,
} from "@vf/video-components";
import { loadOrCompileStoryboard } from "./render-command.js";
import { resolveProjectDir, resolveProjectRoot } from "./project-path.js";

const OUT_DIR = path.join("assets", "excalidraw");

export interface ExcalidrawOptions {
  project: string;
  cwd?: string | undefined;
  /** Animation length for the generated SVGs (seconds per element ≈ 0.5s). */
  durationSec?: number | undefined;
}

/** Excalidraw asset generator (plan T7.1, §4.2): every SvgScene in the
 * storyboard becomes assets/excalidraw/<sceneId>.excalidraw (hand-editable
 * in Excalidraw) + <sceneId>.svg (standalone animated SVG for web/embed).
 * Positioned as an asset generator, NOT a video runtime — the video path
 * for svg scenes stays the T4.3 renderer. */
export async function runExcalidraw(opts: ExcalidrawOptions): Promise<number> {
  let root: string;
  if (opts.project) {
    const resolved = resolveProjectDir(opts.project, opts.cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return 1;
    }
    root = resolved.root;
  } else {
    const resolved = resolveProjectRoot(opts.cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return 1;
    }
    root = resolved.root;
  }

  const { renderPlan } = await loadOrCompileStoryboard(root);
  const svgScenes = renderPlan.scenes.filter((s) => s.renderer === "svg" && s.component === "SvgScene");
  if (svgScenes.length === 0) {
    console.error(
      `excalidraw: no svg/SvgScene scenes in the storyboard — this generator converts diagram scenes (see T4.3)`,
    );
    return 1;
  }

  const outDir = path.join(root, OUT_DIR);
  await mkdir(outDir, { recursive: true });
  const outputs: string[] = [];
  for (const scene of svgScenes) {
    const spec = {
      ...(typeof scene.props.title === "string" ? { title: scene.props.title } : {}),
      nodes: (scene.props.nodes ?? []) as ExcalidrawSpec["nodes"],
      edges: (scene.props.edges ?? []) as ExcalidrawSpec["edges"],
    };
    const parsed = (await import("@vf/video-components")).ExcalidrawSpecSchema.safeParse(spec);
    if (!parsed.success) {
      console.error(
        `  scene ${scene.id}: props not a valid diagram spec — ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`,
      );
      return 1;
    }
    const sceneDuration = scene.durationInFrames / renderPlan.project.fps;
    const excalidraw = svgSpecToExcalidraw(parsed.data);
    const animated = svgSpecToAnimatedSvg(parsed.data, {
      durationSec: opts.durationSec ?? sceneDuration,
    });
    const base = path.join(outDir, scene.id);
    await writeFile(`${base}.excalidraw`, JSON.stringify(excalidraw, null, 2), "utf8");
    await writeFile(`${base}.svg`, animated, "utf8");
    outputs.push(`${OUT_DIR}/${scene.id}.excalidraw`, `${OUT_DIR}/${scene.id}.svg`);
    console.log(`  scene ${scene.id}: ${parsed.data.nodes.length} node(s), ${parsed.data.edges.length} edge(s)`);
  }

  const runId = formatRunId("excalidraw");
  await writeRun(root, {
    run_id: runId,
    stage: "excalidraw",
    status: "succeeded",
    actor: "tool",
    tool: "vf-excalidraw",
    input_commit: safeGitHead(root),
    input_files: ["storyboard/storyboard.yaml"],
    output_files: outputs,
    created_at: new Date().toISOString(),
    duration_ms: 0,
  });

  console.log(`✓ excalidraw assets written to ${OUT_DIR}/ (${outputs.length} file(s))`);
  return 0;
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
