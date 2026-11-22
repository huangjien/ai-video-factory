export {
  COMPONENT_NAMES,
  REGISTRY,
  type RegistryEntry,
  type RegistryPropsByName,
} from "./registry.js";
export {
  DEFAULT_THEME_NAME,
  THEME_META,
  THEME_NAMES,
  THEMES,
  darkTechTheme,
  isValidTheme,
  paperLightTheme,
  oceanDeepTheme,
  duskWarmTheme,
  aiRedTheme,
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
export {
  TITLE_FONTS,
  TITLE_STYLES,
  isTitleStyle,
  type TitleFont,
  type TitleStyle,
} from "./titleFonts.js";

export { Title, type TitleProps } from "./components/Title.js";
export { Paragraph, type ParagraphProps } from "./components/Paragraph.js";
export { Background, type BackgroundProps } from "./components/Background.js";
export {
  ImageBackground,
  type ImageBackgroundProps,
} from "./components/ImageBackground.js";
export {
  SceneBackground,
  type SceneBackgroundProps,
} from "./components/SceneBackground.js";
export {
  Character,
  type CharacterProps,
  speechEnvelope,
} from "./components/Character.js";
export { CodeBlock, type CodeBlockProps } from "./components/CodeBlock.js";
export { Image, type ImageProps } from "./components/Image.js";
export { EndCard, type EndCardProps } from "./components/EndCard.js";
export {
  CaptionsOverlay,
  type CaptionsOverlayProps,
} from "./components/CaptionsOverlay.js";
export {
  TextOverlay,
  overlayOpacity,
  type TextOverlayProps,
} from "./components/TextOverlay.js";
export {
  CAPTION_FONT_RATIO,
  captionFontSize,
  captionHalo,
  captionTextStyle,
  isLightInk,
} from "./captionStyle.js";
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
export {
  DoodleScene,
  DoodleScenePropsSchema,
} from "./components/DoodleScene.js";
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
