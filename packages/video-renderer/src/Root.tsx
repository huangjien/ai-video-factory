import { useCurrentFrame } from "remotion";
import type { RenderPlan, RenderPlanScene } from "@video/vdsl";
import {
  REGISTRY,
  Background,
  CaptionsOverlay,
  resolveTheme,
} from "@video/video-components";

export interface RootProps {
  renderPlan: RenderPlan;
}

/** Transition window in seconds (plan §10 transitions). fps-aware: the
 * frame count scales with the composition so draft (15fps) and final
 * (30fps) renders fade for the same wall-clock time. */
const TRANSITION_SECONDS = 0.6;

export function transitionFramesFor(fps: number): number {
  return Math.max(1, Math.round(TRANSITION_SECONDS * fps));
}

/**
 * Spec-driven scene transitions. A scene fades in over its first window
 * when its transition.in is "fade" (or unspecified — 0.1 storyboards never
 * declared transitions and always faded) and fades out over its last
 * window when transition.out is "fade". An explicit "cut" renders at full
 * opacity from the first frame — a hard switch, no animation.
 *
 * Exactly ONE scene is rendered per frame: the fade happens through the
 * theme background, which keeps timelines deterministic (the next scene's
 * local frame is never consumed early) and avoids rendering a second full
 * scene tree at opacity 0.
 */
export function sceneOpacityAtFrame(
  scene: RenderPlanScene,
  localFrame: number,
  fps: number,
): number {
  const w = transitionFramesFor(fps);
  let opacity = 1;
  const inKind = scene.transition?.in ?? "fade";
  if (inKind === "fade" && localFrame < w) {
    opacity = Math.min(opacity, (localFrame + 1) / w);
  }
  const outKind = scene.transition?.out ?? "fade";
  const exitStart = scene.durationInFrames - w;
  if (outKind === "fade" && localFrame >= exitStart) {
    const fade = Math.max(
      0,
      1 - (localFrame - exitStart) / w,
    );
    opacity = Math.min(opacity, fade);
  }
  return Math.max(0, Math.min(1, opacity));
}

export const Root = ({ renderPlan }: RootProps) => {
  const frame = useCurrentFrame();
  // The storyboard's style.theme picks the palette (plan §25/v0.2 themes);
  // unknown names fall back to dark-tech so a typo never crashes a render.
  const theme = resolveTheme(renderPlan.style.theme);
  const sceneIdx = renderPlan.scenes.findIndex(
    (s) =>
      frame >= s.startFrame && frame < s.startFrame + s.durationInFrames,
  );
  if (sceneIdx === -1) return null;
  const scene = renderPlan.scenes[sceneIdx];
  if (!scene) return null;

  const entry = REGISTRY[scene.component];
  if (!entry) return null;
  const SceneComponent = entry.component;
  const localFrame = frame - scene.startFrame;

  const opacity = sceneOpacityAtFrame(scene, localFrame, renderPlan.project.fps);

  const wrapStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    backgroundColor: theme.colors.background,
  };

  const baseProps = {
    ...scene.props,
    startFrame: scene.startFrame,
    durationInFrames: scene.durationInFrames,
    frame: localFrame,
    // T4.3: timeline animations + fps for renderer-aware components
    // (SvgScene consumes both; passthrough props ignore them).
    animations: scene.animations,
    fps: renderPlan.project.fps,
    theme,
  } as unknown as Record<string, unknown> & React.JSX.IntrinsicElements["div"];

  return (
    <div style={wrapStyle}>
      <Background frame={frame} theme={theme} />
      <div style={{ position: "absolute", inset: 0, opacity }}>
        <SceneComponent {...baseProps} />
      </div>
      {scene.captions ? (
        <CaptionsOverlay
          lines={scene.captions.lines}
          width={renderPlan.project.width}
          height={renderPlan.project.height}
          theme={theme}
        />
      ) : null}
    </div>
  );
};
