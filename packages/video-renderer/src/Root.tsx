import { useCurrentFrame } from "remotion";
import type { RenderPlan, RenderPlanScene } from "@vf/vdsl";
import { REGISTRY, Background } from "@vf/video-components";
import { darkTechTheme } from "@vf/video-components";

export interface RootProps {
  renderPlan: RenderPlan;
}

function findScene(
  scenes: RenderPlanScene[],
  frame: number,
): RenderPlanScene | undefined {
  let active: RenderPlanScene | undefined;
  for (const scene of scenes) {
    if (
      frame >= scene.startFrame &&
      frame < scene.startFrame + scene.durationInFrames
    ) {
      active = scene;
      break;
    }
  }
  return active;
}

/**
 * Cross-fade between adjacent scenes. In the last `transitionFrames`
 * of the current scene and the first `transitionFrames` of the next
 * scene, both are rendered with complementary opacities so one
 * dissolves into the other.
 */
function crossfadeOpacity(
  frame: number,
  scene: RenderPlanScene,
  next: RenderPlanScene | undefined,
  transitionFrames: number,
): number {
  if (!next) return 1;
  const localFrame = frame - scene.startFrame;
  const exitStart = scene.durationInFrames - transitionFrames;
  if (localFrame >= exitStart) {
    return Math.max(
      0,
      1 - (localFrame - exitStart) / transitionFrames,
    );
  }
  return 1;
}

function nextSceneOpacity(
  frame: number,
  scene: RenderPlanScene,
  next: RenderPlanScene | undefined,
  transitionFrames: number,
): number {
  if (!next) return 0;
  const localFrame = frame - scene.startFrame;
  const enterEnd = transitionFrames;
  if (localFrame < scene.durationInFrames - enterEnd) return 0;
  const startNext = frame - next.startFrame;
  if (startNext >= transitionFrames) return 0;
  return Math.max(0, Math.min(1, startNext / transitionFrames));
}

export const Root = ({ renderPlan }: RootProps) => {
  const frame = useCurrentFrame();
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

  const next = renderPlan.scenes[sceneIdx + 1];
  const nextEntry = next ? REGISTRY[next.component] : undefined;
  const transitionFrames = 18;
  const fadeOut = crossfadeOpacity(frame, scene, next, transitionFrames);
  const fadeIn = nextSceneOpacity(frame, scene, next, transitionFrames);

  const wrapStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    backgroundColor: darkTechTheme.colors.background,
  };

  const baseProps = {
    ...scene.props,
    startFrame: scene.startFrame,
    durationInFrames: scene.durationInFrames,
    frame: localFrame,
  } as unknown as Record<string, unknown> & React.JSX.IntrinsicElements["div"];

  const nextProps = next
    ? ({
        ...next.props,
        startFrame: next.startFrame,
        durationInFrames: next.durationInFrames,
        frame: Math.max(0, frame - next.startFrame),
      } as unknown as Record<string, unknown> & React.JSX.IntrinsicElements["div"])
    : null;

  return (
    <div style={wrapStyle}>
      <Background frame={frame} />
      <div style={{ position: "absolute", inset: 0, opacity: fadeOut }}>
        <SceneComponent {...baseProps} />
      </div>
      {next && nextProps && nextEntry ? (
        <div style={{ position: "absolute", inset: 0, opacity: fadeIn }}>
          <nextEntry.component {...nextProps} />
        </div>
      ) : null}
    </div>
  );
};
