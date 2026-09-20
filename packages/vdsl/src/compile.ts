import { wrapText } from "@vf/media";
import { stringify as yamlStringify } from "yaml";
import type { Storyboard } from "./schema.js";
import { validateStoryboard } from "./validate.js";

const DEFAULT_CAPTION_UNITS = 24;

export type AnimationEntrance =
  "none" | "fade" | "slide" | "scale" | "draw" | "typewriter";
export type EmphasisKind = "none" | "highlight" | "counter";
export type ExitKind = "none" | "fade";
export type TransitionKind = "fade" | "cut";

export interface RenderPlanScene {
  id: string;
  index: number;
  startFrame: number;
  durationInFrames: number;
  component: string;
  props: Record<string, unknown>;
  animation: {
    entrance: AnimationEntrance;
    emphasis: EmphasisKind;
    exit: ExitKind;
  };
  captions: { lines: string[] } | null;
  audio: string | null;
}

export interface RenderPlan {
  project: Storyboard["project"];
  style: { theme: string };
  totalFrames: number;
  scenes: RenderPlanScene[];
}

/**
 * Deterministic compile storyboard -> normalized vdsl.yaml + RenderPlan.
 * Frame math: Math.round(duration * fps) — §21.1 line 887 (seconds in,
 * frames internal). Renderer reads only the normalized vdsl.yaml / RenderPlan
 * (§21.1 line 948).
 */
export function compileStoryboard(
  text: string,
  projectRoot: string,
): { renderPlan: RenderPlan; yaml: string; write: () => Promise<void> } {
  const shape = validateStoryboard(text, "storyboard.yaml");
  if (!shape.ok) {
    const msg = shape.errors
      .map((e) => `${e.file}:${e.line} ${e.field} ${e.message}`)
      .join("\n");
    throw new Error(`Compile refused — input is not shape-valid VDSL:\n${msg}`);
  }
  const board = shape.data;

  let cursor = 0;
  const scenes: RenderPlanScene[] = board.scenes.map((scene, index) => {
    const durationInFrames = Math.round(scene.duration * board.project.fps);
    const startFrame = cursor;
    cursor += durationInFrames;

    const narration = scene.narration;
    const captionText =
      scene.captions?.text ??
      (scene.captions?.source === "narration" ? narration?.text : undefined);
    const captions = captionText
      ? { lines: wrapText(captionText, DEFAULT_CAPTION_UNITS) }
      : null;

    return {
      id: scene.id,
      index,
      startFrame,
      durationInFrames,
      component: scene.visual.component,
      props: scene.visual.props,
      animation: {
        entrance: scene.animation?.entrance ?? "none",
        emphasis: scene.animation?.emphasis ?? "none",
        exit: scene.animation?.exit ?? "none",
      },
      captions,
      audio: narration?.audio ?? null,
    };
  });

  const renderPlan: RenderPlan = {
    project: board.project,
    style: { theme: board.style?.theme ?? "dark-tech" },
    totalFrames: cursor,
    scenes,
  };

  const yaml = yamlStringify(board);
  const outDir = `${projectRoot.replace(/\/$/, "")}/vdsl`;
  const write = async (): Promise<void> => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(outDir, { recursive: true });
    await writeFile(`${outDir}/vdsl.yaml`, yaml, "utf8");
  };

  return { renderPlan, yaml, write };
}
