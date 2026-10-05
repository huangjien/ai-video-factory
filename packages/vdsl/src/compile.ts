import { wrapText } from "@video/media";
import { stringify as yamlStringify } from "yaml";
import type {
  Asset,
  BrandConfig,
  Storyboard,
  TimelineAnimation,
} from "./schema.js";
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
  /** Which runtime draws this scene — see schema.ts VISUAL_RENDERERS. */
  renderer: string;
  props: Record<string, unknown>;
  animation: {
    entrance: AnimationEntrance;
    emphasis: EmphasisKind;
    exit: ExitKind;
  };
  /** Timeline animations (plan §10), scene-relative seconds preserved. */
  animations: TimelineAnimation[];
  /** Spec-driven transition (plan §8/§10). null = storyboard declared no
   * transition; the renderer then applies its own defaults. */
  transition: { in: TransitionKind; out: TransitionKind } | null;
  captions: { lines: string[] } | null;
  audio: string | null;
}

export interface RenderPlan {
  project: Storyboard["project"];
  style: { theme: string; brand?: BrandConfig };
  totalFrames: number;
  scenes: RenderPlanScene[];
  /** Project-level asset manifest (plan §11), carried for renderer/QA. */
  assets?: Asset[];
}

export interface CompileOptions {
  /** Draft-mode overrides (plan §27): change the frame math + composition
   * geometry without touching the storyboard. Scene durations stay in
   * seconds; only seconds→frames conversion and width/height change. */
  fps?: number;
  width?: number;
  height?: number;
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
  opts: CompileOptions = {},
): { renderPlan: RenderPlan; yaml: string; write: () => Promise<void> } {
  const shape = validateStoryboard(text, "storyboard.yaml");
  if (!shape.ok) {
    const msg = shape.errors
      .map((e) => `${e.file}:${e.line} ${e.field} ${e.message}`)
      .join("\n");
    throw new Error(`Compile refused — input is not shape-valid VDSL:\n${msg}`);
  }
  const board = shape.data;
  const fps = opts.fps ?? board.project.fps;
  const project: RenderPlan["project"] = {
    ...board.project,
    fps,
    ...(opts.width !== undefined ? { width: opts.width } : {}),
    ...(opts.height !== undefined ? { height: opts.height } : {}),
  };

  let cursor = 0;
  const scenes: RenderPlanScene[] = board.scenes.map((scene, index) => {
    const durationInFrames = Math.round(scene.duration * fps);
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
      renderer: scene.visual.renderer,
      props: scene.visual.props,
      animation: {
        entrance: scene.animation?.entrance ?? "none",
        emphasis: scene.animation?.emphasis ?? "none",
        exit: scene.animation?.exit ?? "none",
      },
      animations: scene.animations ?? [],
      transition: scene.transition
        ? { in: scene.transition.in, out: scene.transition.out }
        : null,
      captions,
      audio: narration?.audio ?? null,
    };
  });

  const renderPlan: RenderPlan = {
    project,
    style: {
      theme: board.style?.theme ?? "paper-light",
      ...(board.style?.brand ? { brand: board.style.brand } : {}),
    },
    totalFrames: cursor,
    scenes,
    ...(board.assets ? { assets: board.assets } : {}),
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

/** Slice a plan down to a single scene (scene isolation, plan Principle 1):
 * the scene becomes the whole composition starting at frame 0, so it can
 * be rendered independently and concat'd back into the full video. */
export function slicePlanScene(
  plan: RenderPlan,
  sceneId: string,
): { plan: RenderPlan; scene: RenderPlanScene } {
  const scene = plan.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    throw new Error(
      `slicePlanScene: scene "${sceneId}" not in plan (has: ${plan.scenes.map((s) => s.id).join(", ")})`,
    );
  }
  const sliced: RenderPlanScene = { ...scene, startFrame: 0 };
  return {
    plan: { ...plan, totalFrames: scene.durationInFrames, scenes: [sliced] },
    scene,
  };
}
