import { useCurrentFrame } from "remotion";
import type { RenderPlan, RenderPlanScene } from "@vf/vdsl";
import { REGISTRY } from "@vf/video-components";
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

export const Root = ({ renderPlan }: RootProps) => {
  const frame = useCurrentFrame();
  const scene = findScene(renderPlan.scenes, frame);
  if (!scene) return null;

  const entry = REGISTRY[scene.component];
  if (!entry) return null;

  const SceneComponent = entry.component;
  const localFrame = frame - scene.startFrame;
  const wrapStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    backgroundColor: darkTechTheme.colors.background,
  };

  const sceneProps = {
    ...scene.props,
    startFrame: scene.startFrame,
    durationInFrames: scene.durationInFrames,
    frame: localFrame,
  } as unknown as Record<string, unknown> & React.JSX.IntrinsicElements["div"];

  return (
    <div style={wrapStyle}>
      <SceneComponent {...sceneProps} />
    </div>
  );
};
