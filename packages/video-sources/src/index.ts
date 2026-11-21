export {
  CLIP_FPS,
  CLIP_HEIGHT,
  CLIP_WIDTH,
  preprocessClip,
  type PreprocessClipOptions,
} from "./preprocess.js";

export {
  downloadClip,
  MAX_CLIP_DOWNLOAD_BYTES,
  type DownloadedClip,
} from "./download.js";

export {
  filterFreeVideos,
  MAX_CANDIDATE_BYTES,
  CommonsVideoSource,
  parseCommonsVideoResponse,
  type CommonsVideoSourceOptions,
} from "./sources/commons-video.js";

export {
  collectVideoCandidates,
  dedupeVideos,
  pickBestVideo,
  resolveSceneVideo,
  scoreVideoCandidate,
  searchAllVideoSources,
  videoDigest,
  videoQueryVariants,
  videoTokenSet,
  type VideoSearchOptionsInternal,
} from "./retrieve.js";

export {
  MAX_VIDEO_SCENES,
  VideoSourcePlanError,
  buildVideoPlanMessages,
  normalizeVideoPlan,
  planSceneVideos,
  type PlanVideoInput,
  type PlanVideoSceneInput,
} from "./plan.js";

export {
  VideoSourceMatchError,
  buildVideoMatchMessages,
  matchSceneVideos,
  type SceneVideoCandidates,
  type VideoMatchCandidate,
} from "./match.js";

export {
  readSceneVideoSource,
  readAllSceneVideoSources,
  recordFromResolution,
  sceneVideoSourcePath,
  shortVideoAuthor,
  writeSceneVideoSource,
  writeVideoAttributionFile,
  VIDEO_ATTRIBUTION_FILENAME,
  type SceneVideoRecord,
} from "./attribution.js";

export {
  readVideoPlanCache,
  videoPlanCacheKey,
  videoPlanPath,
  writeVideoPlanCache,
  VIDEO_PLAN_FILENAME,
} from "./plan-cache.js";

export type {
  SceneVideoPlan,
  SceneVideoPick,
  SceneVideoResolution,
  VideoCandidate,
  VideoSearchOptions,
  VideoSource,
  VideoSourceName,
} from "./types.js";
