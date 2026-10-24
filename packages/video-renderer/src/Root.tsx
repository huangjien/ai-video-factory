import { useCurrentFrame } from "remotion";
import type { RenderPlan, RenderPlanScene } from "@video/vdsl";
import {
  REGISTRY,
  Background,
  BrandIntro,
  BrandWatermark,
  CaptionsOverlay,
  SceneBackground,
  TextOverlay,
  resolveTheme,
} from "@video/video-components";

export interface RootProps {
  renderPlan: RenderPlan;
}

/** Transition window in seconds (plan §10 transitions). fps-aware: the
 * frame count scales with the composition so draft (15fps) and final
 * (30fps) renders fade for the same wall-clock time. */
const TRANSITION_SECONDS = 0.6;

/**
 * Does the caption track draw text for this scene?
 *
 * Caption precedence. Two layers can draw a caption for one scene: the
 * `CaptionsOverlay` track, and `ImageBackground`'s own `caption` prop (which
 * `video make` fills by copying the scene's text into it). Both draw at the
 * bottom of the frame, so when both fire the frame shows two different lines
 * printed on top of each other — unreadable, on every generated-image scene.
 *
 * The component's own caption wins, because it carries the scene's
 * `caption:` field: the human's own short on-screen label, capped at a few
 * words by the article spec. The track falls back to the narration when
 * `captions.source` is `narration`, which is a sentence or two — far too long
 * for an on-screen caption. On an image scene the short label is the better
 * caption, so it is the one that gets drawn.
 *
 * The track still owns every non-image scene, and any image scene whose
 * component caption is empty.
 */
export type CaptionOwner = "component" | "track" | "none";

export interface CaptionWiring {
  owner: CaptionOwner;
  /**
   * Props merged over `scene.props` before the component renders. Empty when
   * the component owns the caption; strips `caption` otherwise.
   *
   * This override has to exist because `scene.props` is spread into
   * `baseProps` first, so the decision must actively UNSET the prop. In
   *verting it is invisible to `sceneCaptionOwner`'s own tests — the
   * component silently loses its caption while the track stays gated off,
   * and the scene renders with no text at all. Returned here, next to
   * `renderTrack`, so the two sides cannot disagree.
   */
  componentPropOverride: Record<string, unknown>;
  /** Whether the `CaptionsOverlay` track renders this scene. */
  renderTrack: boolean;
}

/** `ImageBackground` is the only registered component with a `caption` prop. */
const COMPONENT_CAPTION_COMPONENTS = new Set(["ImageBackground"]);

export function sceneCaptionOwner(
  component: string,
  props: Record<string, unknown> | undefined,
  captions: RenderPlanScene["captions"],
): CaptionOwner {
  if (COMPONENT_CAPTION_COMPONENTS.has(component)) {
    const text = props?.["caption"];
    if (typeof text === "string" && text.trim() !== "") return "component";
  }
  if ((captions?.cues?.length ?? 0) > 0) return "track";
  return "none";
}

/** Both halves of the decision, so they cannot drift apart. */
export function captionWiring(
  component: string,
  props: Record<string, unknown> | undefined,
  captions: RenderPlanScene["captions"],
): CaptionWiring {
  const owner = sceneCaptionOwner(component, props, captions);
  return {
    owner,
    componentPropOverride: owner === "component" ? {} : { caption: undefined },
    renderTrack: owner === "track",
  };
}

function transitionFramesFor(fps: number): number {
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
function sceneOpacityAtFrame(
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
    const fade = Math.max(0, 1 - (localFrame - exitStart) / w);
    opacity = Math.min(opacity, fade);
  }
  return Math.max(0, Math.min(1, opacity));
}

/**
 * The film's head and tail fade through black.
 *
 * A video whose first frame is a bare lit canvas reads as a mistake, not
 * as a cut — the eye has nothing to land on and the voice arrives before
 * the picture does. Fading in from black (and out to it) gives the
 * opening a frame to arrive on, and closes the film the same way.
 *
 * Pure function so the shape can be asserted without rendering: the head
 * starts fully black and lifts over `fadeFrames`; the tail darkens over
 * the last `fadeFrames` and ends fully black.
 */
export function edgeFadeOpacity(
  absoluteStartFrame: number,
  absoluteEndFrame: number,
  localFrame: number,
  sceneDurationInFrames: number,
  filmTotalFrames: number,
  fadeFrames: number,
): number {
  if (fadeFrames <= 0) return 0;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  // The fade belongs to the FILM's edges, not to every scene: a scene
  // that opens the film fades in from black, the one that closes it
  // fades out — and nothing in between does.
  const head =
    absoluteStartFrame === 0 ? clamp(1 - localFrame / fadeFrames) : 0;
  const tail =
    absoluteEndFrame >= filmTotalFrames && sceneDurationInFrames > 1
      ? clamp(
          (localFrame - (sceneDurationInFrames - fadeFrames)) /
            (fadeFrames - 1),
        )
      : 0;
  return clamp(Math.max(head, tail));
}

/** How long the film's edge fade runs, in seconds. */
export const EDGE_FADE_SEC = 0.8;

export const Root = ({ renderPlan }: RootProps) => {
  const frame = useCurrentFrame();
  // The storyboard's style.theme picks the palette (plan §25/v0.2 themes);
  // unknown names fall back to dark-tech so a typo never crashes a render.
  const theme = resolveTheme(renderPlan.style.theme);
  const sceneIdx = renderPlan.scenes.findIndex(
    (s) => frame >= s.startFrame && frame < s.startFrame + s.durationInFrames,
  );
  if (sceneIdx === -1) return null;
  const scene = renderPlan.scenes[sceneIdx];
  if (!scene) return null;

  const entry = REGISTRY[scene.component];
  if (!entry) return null;
  const SceneComponent = entry.component;
  const localFrame = frame - scene.startFrame;

  const opacity = sceneOpacityAtFrame(
    scene,
    localFrame,
    renderPlan.project.fps,
  );

  // The film's head and tail fade through black (see edgeFadeOpacity).
  // The positions are ABSOLUTE: in a per-scene render the plan is
  // rebased to frame 0, so `frameOffsetFrames` carries where the scene
  // really sits in the film.
  const absoluteStartFrame = renderPlan.frameOffsetFrames ?? scene.startFrame;
  const edgeFade = edgeFadeOpacity(
    absoluteStartFrame,
    absoluteStartFrame + scene.durationInFrames,
    localFrame,
    scene.durationInFrames,
    renderPlan.filmTotalFrames ?? renderPlan.totalFrames,
    Math.round(EDGE_FADE_SEC * renderPlan.project.fps),
  );

  // Which layer draws this scene's caption — exactly one of them does, and
  // both halves of that decision come from one call.
  const caption = captionWiring(scene.component, scene.props, scene.captions);

  // A bound background image replaces the theme fill: the wrapper goes
  // transparent and the component's own `theme.colors.background` fill
  // (every REGISTRY component paints one) is neutralised below, so the
  // photo shows through instead of being covered by flat colour.
  const hasBackground = typeof scene.backgroundSrc === "string";
  const sceneTheme = hasBackground
    ? { ...theme, colors: { ...theme.colors, background: "transparent" } }
    : theme;

  const wrapStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    backgroundColor: sceneTheme.colors.background,
  };

  const baseProps = {
    ...scene.props,
    startFrame: scene.startFrame,
    durationInFrames: scene.durationInFrames,
    frame: localFrame,
    // T4.3: timeline animations + fps for renderer-aware components
    // (DoodleScene consumes both; passthrough props ignore them).
    animations: scene.animations,
    fps: renderPlan.project.fps,
    theme: sceneTheme,
    // Frame height so components that draw their own text can scale it
    // instead of hardcoding pixels.
    height: renderPlan.project.height,
    ...caption.componentPropOverride,
  } as unknown as Record<string, unknown> & React.JSX.IntrinsicElements["div"];

  return (
    <div style={wrapStyle}>
      {hasBackground ? (
        <SceneBackground
          src={scene.backgroundSrc as string}
          scrim={scene.backgroundScrim !== false}
          theme={theme}
          startFrame={scene.startFrame}
          durationInFrames={scene.durationInFrames}
          frame={localFrame}
        />
      ) : (
        <Background frame={frame} theme={theme} />
      )}
      <div style={{ position: "absolute", inset: 0, opacity }}>
        <SceneComponent {...baseProps} />
      </div>
      {scene.captions && caption.renderTrack ? (
        <CaptionsOverlay
          cues={scene.captions.cues}
          localFrame={localFrame}
          fps={renderPlan.project.fps}
          width={renderPlan.project.width}
          height={renderPlan.project.height}
          theme={theme}
        />
      ) : null}
      {/* CS-06: the title / chapter text layer, composited OVER the
          scene's own picture. It never replaces the image and never
          becomes a scene of its own. */}
      {scene.overlay ? (
        <TextOverlay
          title={scene.overlay.title}
          chapter={scene.overlay.chapter}
          position={scene.overlay.position}
          startSec={scene.overlay.startSec}
          endSec={scene.overlay.endSec}
          sceneSec={localFrame / renderPlan.project.fps}
          width={renderPlan.project.width}
          height={renderPlan.project.height}
          theme={theme}
        />
      ) : null}
      {/* Branding (2026-10-05): fixed opening chrome inside the intro
          window, then the corner watermark on every frame of every scene.
          BrandIntro gates on ABSOLUTE video time — in per-scene sliced
          compositions useCurrentFrame() is scene-relative, so add the
          plan's rebase offset (0/undefined in whole-plan renders). */}
      {renderPlan.style.brand ? (
        <BrandIntro
          brand={renderPlan.style.brand}
          frame={frame + (renderPlan.frameOffsetFrames ?? 0)}
          fps={renderPlan.project.fps}
          width={renderPlan.project.width}
        />
      ) : null}
      {renderPlan.style.brand ? (
        <BrandWatermark
          brand={renderPlan.style.brand}
          width={renderPlan.project.width}
          height={renderPlan.project.height}
        />
      ) : null}
      {/* The film's head/tail fade through black — the topmost layer, so
          it covers picture, captions and chrome alike (above the
          branding's z-index 40). */}
      {edgeFade > 0 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "#000000",
            opacity: edgeFade,
            zIndex: 50,
          }}
        />
      ) : null}
    </div>
  );
};
