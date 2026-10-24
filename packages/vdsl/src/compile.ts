import { buildCaptionCues, type CaptionCue } from "@video/media";
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
  captions: { cues: CaptionCue[] } | null;
  /** CS-06 — the text layer composited over the scene's own image.
   *  Absent or null = no overlay; the scene shows its picture alone. */
  overlay?: {
    title?: string;
    chapter?: string;
    position: "top" | "bottom";
    startSec: number;
    endSec: number;
  } | null;
  audio: string | null;
  /** Renderer-bound background image (data URL) — `resolveImageSources`
   *  binds `assets/images/scene_N.jpg` when it exists, so EVERY component
   *  draws on the generated scene art. null = no image; the scene paints
   *  the theme background. Bound at render time only — never part of
   *  vdsl.yaml, so recompilation stays byte-identical. */
  backgroundSrc?: string | null;
  /** Dark gradient over `backgroundSrc` so overlaid text stays legible.
   *  Default true; a storyboard opts out with `background: {scrim: false}`. */
  backgroundScrim?: boolean;
}

export interface RenderPlan {
  project: Storyboard["project"];
  style: { theme: string; brand?: BrandConfig; channel_profile?: string };
  totalFrames: number;
  scenes: RenderPlanScene[];
  /** Absolute project root, carried from compileStoryboard. Lets the
   *  renderer resolve project-relative assets (scene background images)
   *  without every call site having to thread the root through. Never
   *  written to vdsl.yaml. */
  projectRoot?: string;
  /** Project-level asset manifest (plan §11), carried for renderer/QA. */
  assets?: Asset[];
  /** When this plan is a sliced single-scene composition
   *  (`slicePlanScene`), local frame 0 maps to this absolute frame —
   *  absolute-time overlays (BrandIntro's intro window) need it because
   *  per-scene renders rebase `useCurrentFrame()` to 0 per scene.
   *  Undefined/0 = frames are already absolute (whole-plan renders). */
  frameOffsetFrames?: number;
  /** The FILM's total frame count, carried into a sliced composition.
   *  `slicePlanScene` overwrites `totalFrames` with the single scene's
   *  length, which loses the information "is this the film's last
   *  scene?" — the head/tail fade needs it, and without it every scene
   *  would fade to black at its own edges. Undefined = `totalFrames` is
   *  already the film's length (whole-plan renders). */
  filmTotalFrames?: number;
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
    // CS-03: the cue window is the scene's SPOKEN length when it is known
    // (the scene also holds silence), never the whole scene — timing the
    // cues across the hold would make the text lag the voice.
    // The lead-in is the scene's opening beat: the voice starts AFTER it,
    // so the window shrinks by it and the cues start at it.
    const leadInSec = scene.lead_in_sec ?? 0;
    const captionWindow =
      scene.captions?.speech_sec ?? Math.max(0, scene.duration - leadInSec);
    const captions = captionText
      ? {
          cues: buildCaptionCues(captionText, captionWindow, {
            maxUnits: DEFAULT_CAPTION_UNITS,
            ...(scene.captions?.highlight_terms !== undefined
              ? { markers: scene.captions.highlight_terms }
              : {}),
          }).map((cue) => ({
            ...cue,
            startSec: cue.startSec + leadInSec,
            endSec: cue.endSec + leadInSec,
          })),
        }
      : null;
    // CS-06: the overlay's window defaults to the scene's own span; a
    // storyboard that wants the title to fade out early sets end_sec.
    const overlaySpec = scene.overlay;
    const overlay =
      overlaySpec !== undefined &&
      (overlaySpec.title !== undefined || overlaySpec.chapter !== undefined)
        ? {
            ...(overlaySpec.title !== undefined
              ? { title: overlaySpec.title }
              : {}),
            ...(overlaySpec.chapter !== undefined
              ? { chapter: overlaySpec.chapter }
              : {}),
            position: overlaySpec.position,
            startSec: overlaySpec.start_sec ?? 0,
            endSec: overlaySpec.end_sec ?? scene.duration,
          }
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
      overlay,
      audio: narration?.audio ?? null,
      backgroundScrim: scene.visual.background?.scrim ?? true,
    };
  });

  const renderPlan: RenderPlan = {
    project,
    style: {
      theme: board.style?.theme ?? "paper-light",
      ...(board.style?.channel_profile
        ? { channel_profile: board.style.channel_profile }
        : {}),
      ...(board.style?.brand ? { brand: board.style.brand } : {}),
    },
    totalFrames: cursor,
    scenes,
    projectRoot,
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
    // frameOffsetFrames preserves the scene's absolute position so
    // absolute-time overlays (BrandIntro) keep working in the sliced
    // composition — without it the intro window restarts at every scene.
    plan: {
      ...plan,
      totalFrames: scene.durationInFrames,
      scenes: [sliced],
      frameOffsetFrames: scene.startFrame,
      // The film's real length, so the renderer can still tell whether
      // this scene opens or closes the film.
      filmTotalFrames: plan.filmTotalFrames ?? plan.totalFrames,
    },
    scene,
  };
}
