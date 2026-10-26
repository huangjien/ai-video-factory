export {
  ArticleFrontmatterSchema,
  SceneBlockSchema,
  parseArticle,
  parseArticleLenient,
  parseArticleWithRecovery,
  recoverEmptyNarrations,
  articleToStoryboardYaml,
  type ArticleFrontmatter,
  type Scene,
  type SceneBlock,
  type ParsedArticle,
  type ArticleWithRecovery,
} from "./schemas.js";
export { SYSTEM_PROMPT, buildMessages, type DraftInput } from "./prompt.js";
export {
  CHANNEL_PROFILES,
  resolveChannelProfile,
  channelDraftBlock,
  channelReviewBlock,
  withChannelBlock,
  type ChannelProfile,
} from "./channel-profile.js";
export {
  ANCHOR_BASIS,
  REFERENCE_STATUS,
  CharacterProfileSchema,
  approveReference,
  anchorPromptLines,
  anchorsForVariant,
  approvedReferenceFor,
  type AnchoredValue,
  type CharacterProfile,
  type CharacterReference,
  type CharacterVariant,
} from "./character-profile.js";
export {
  approveCharacterReference,
  buildSheetPrompt,
  characterFilePath,
  characterRootFor,
  listCharacterIds,
  loadCharacterById,
  loadCharacterProfile,
  nextVersionLabel,
  referenceFilePath,
  workspaceCharacterRoot,
  writeCandidateReference,
  type ApprovalOutcome,
  type CandidateWrite,
} from "./character-bible.js";
export {
  identityDigest,
  resolveSceneIdentities,
  type SceneIdentity,
} from "./scene-identity.js";
export { callDraft, DraftError, type CallDraftResult } from "./agent.js";
export {
  translateArticle,
  canonicalLanguage,
  hasL10n,
  l10nArticlePath,
  captionsSourceFor,
  TranslateArticleError,
  type TranslateArticleOptions,
  type TranslateArticleResult,
} from "./translate-article.js";
export {
  PROFILE,
  PROFILE_ID,
  DEFAULT_MIN_SCORE,
  MAX_POSSIBLE_SCORE,
  SEVERITIES,
  ArticleScoreRawSchema,
  buildArticleReviewMessages,
  computeScore,
  dropHallucinatedQuotes,
  gradeFor,
  passesBar,
  scoreArticle,
  scoreTotal,
  runScoredDraft,
  renderArticleReviewYaml,
  ArticleReviewError,
  type Severity,
  type DimensionDef,
  type ArticleScoreRaw,
  type DimensionScore,
  type ComputedScore,
  type ArticleScore,
  type ScoredAttempt,
  type ScoredDraftResult,
  type ScoredDraftOptions,
} from "./article-review.js";
export {
  pickVisualComponent,
  DEFAULT_VISUAL_COMPONENT,
  type ComponentChoice,
  type ComponentName,
} from "./visual-classifier.js";
export {
  buildScenePromptMessages,
  expandSceneBrief,
  expandScenePrompt,
  IMAGE_PROMPT_REVISION,
  type ExpandSceneOptions,
  type ScenePromptContext,
  type ScenePromptInput,
  type ExpandedPrompt,
} from "./image-prompt.js";
export {
  DEFAULT_IMAGE_STYLE,
  IMAGE_STYLES,
  IMAGE_STYLE_PRESETS,
  resolveImageStyle,
  stylePromptSuffix,
  styleSystemBlock,
  type ImageStyle,
} from "./image-style.js";
export {
  VISUAL_BUILDERS,
  type BuildInput,
  type VisualPropsBuilder,
} from "./visual-builders.js";
export {
  emitSceneAnimations,
  type EmitContext,
  type TimelineAnimation,
} from "./animation-emitter.js";
