export {
  DOUYIN_DESCRIPTION_MAX,
  DOUYIN_HEIGHT,
  DOUYIN_TITLE_MAX,
  DOUYIN_TOPIC_MAX,
  DOUYIN_TOPICS_MAX,
  DOUYIN_WIDTH,
  DouyinPackageSchema,
  DouyinPublishResultSchema,
  type DouyinPackage,
  type DouyinPublishResult,
} from "./schemas.js";

export {
  buildDouyinMessages,
  SYSTEM_PROMPT,
  type DouyinInput,
} from "./prompt.js";

export {
  buildFallbackPackage,
  clampChars,
  deriveTopics,
  type FallbackInput,
} from "./fallback.js";

export {
  callDouyin,
  DouyinError,
  extractYaml,
  type CallDouyinResult,
} from "./agent.js";

export { renderChecklist, type ChecklistInput } from "./checklist.js";

export {
  cutVertical,
  verticalCutIsFresh,
  verticalFilter,
  VerticalCutError,
  type VerticalCutMode,
  type VerticalCutOptions,
} from "./cut.js";

export {
  DOUYIN_API_BASE,
  DOUYIN_TOKEN_PATH,
  DOUYIN_VIDEO_CREATE_PATH,
  DOUYIN_VIDEO_UPLOAD_PATH,
  DouyinUploadError,
  exchangeCodeForToken,
  readClientSecret,
  uploadDouyin,
  type DouyinClientSecret,
  type UploadDouyinOptions,
} from "./uploader.js";
