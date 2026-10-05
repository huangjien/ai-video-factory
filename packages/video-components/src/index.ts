export {
  COMPONENT_NAMES,
  REGISTRY,
  type RegistryEntry,
  type RegistryPropsByName,
} from "./registry.js";
export {
  THEME_NAMES,
  THEMES,
  darkTechTheme,
  isValidTheme,
  paperLightTheme,
  oceanDeepTheme,
  duskWarmTheme,
  resolveTheme,
  type Theme,
} from "./theme.js";
export {
  draw,
  fade,
  scale,
  slide,
  typewriter,
  type SlideResult,
} from "./animations.js";

export { Title, type TitleProps } from "./components/Title.js";
export { Paragraph, type ParagraphProps } from "./components/Paragraph.js";
export { AnimatedIllustration, type IllustrationProps } from "./components/Illustration.js";
export { Background, type BackgroundProps } from "./components/Background.js";
export { ImageBackground, type ImageBackgroundProps } from "./components/ImageBackground.js";
export { Character, type CharacterProps, speechEnvelope } from "./components/Character.js";
export { CodeBlock, type CodeBlockProps } from "./components/CodeBlock.js";
export { Terminal, type TerminalProps } from "./components/Terminal.js";
export { Image, type ImageProps } from "./components/Image.js";
export { FlowChart, type FlowChartProps } from "./components/FlowChart.js";
export { Comparison, type ComparisonProps } from "./components/Comparison.js";
export { Timeline, type TimelineProps } from "./components/Timeline.js";
export { Callout, type CalloutProps } from "./components/Callout.js";
export { EndCard, type EndCardProps } from "./components/EndCard.js";
export { QuoteBlock, type QuoteBlockProps } from "./components/QuoteBlock.js";
export { StatGrid, type StatEntry, type StatGridProps } from "./components/StatGrid.js";
export { BarChart, type Bar, type BarChartProps } from "./components/BarChart.js";
export {
  Leaderboard,
  type LeaderboardEntry,
  type LeaderboardProps,
} from "./components/Leaderboard.js";
export { Checklist, type ChecklistItem, type ChecklistProps } from "./components/Checklist.js";
export { BigIdea, type BigIdeaProps } from "./components/BigIdea.js";
export {
  PyramidDiagram,
  type PyramidDiagramProps,
} from "./components/PyramidDiagram.js";
export { VennDiagram, type VennDiagramProps } from "./components/VennDiagram.js";
export {
  CycleDiagram,
  type CycleDiagramProps,
} from "./components/CycleDiagram.js";
export {
  CaptionsOverlay,
  type CaptionsOverlayProps,
} from "./components/CaptionsOverlay.js";
export {
  BrandWatermark,
  BrandIntro,
  INTRO_GRADIENTS,
  cornerStyle,
  introGradient,
  introWindowActive,
  type BrandCorner,
  type BrandIntroProps,
  type BrandWatermarkProps,
} from "./components/BrandOverlay.js";
export { SvgScene, SvgScenePropsSchema } from "./components/SvgScene.js";
export {
  DoodleScene,
  DoodleScenePropsSchema,
} from "./components/DoodleScene.js";
export {
  ExcalidrawSpecSchema,
  svgSpecToAnimatedSvg,
  svgSpecToExcalidraw,
  type ExcalidrawSpec,
} from "./components/excalidraw.js";
export {
  buildStrokePlan,
  drawDoodleFrame,
  hashStr,
  rng,
  shapeStrokes,
  wobblePoints,
  type CtxLike,
  type DoodleShape,
  type DoodleStrokeSpec,
  type DoodleStyle,
  type StrokePlanEntry,
} from "./components/doodleLogic.js";
export {
  easeAtProgress,
  resolveElementTiming,
  elementProgress,
  type ElementTiming,
  type SceneElementRef,
  type TimelineAnim,
  type VdslEasing,
} from "./components/svgSceneLogic.js";
