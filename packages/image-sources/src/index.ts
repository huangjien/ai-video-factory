export {
  type HistoricalCandidate,
  type PictureSearchOptions,
  type PictureSource,
  type PictureSourceName,
  type SceneSourcePlan,
  type SceneSourceResolution,
  type SourceMode,
} from "./types.js";

/** HTTP helpers shared with @video/video-sources (same Wikimedia API
 *  family, same User-Agent policy, same deadline discipline). */
export { fetchJson, qs, stripHtml, USER_AGENT } from "./http.js";

export {
  FREE_LICENSES,
  isFreeLicense,
  normalizeLicense,
  OWNED_LICENSE,
} from "./license.js";

export {
  buildPlanMessages,
  ImageSourcePlanError,
  normalizePlan,
  planSceneSources,
  type PlanInput,
  type PlanSceneInput,
} from "./plan.js";

export {
  collectCandidates,
  dedupe,
  downloadCandidate,
  filterFree,
  MAX_DOWNLOAD_BYTES,
  pickBest,
  queryVariants,
  resolutionAsFrame,
  resolveSceneSource,
  retrieveForScenes,
  scoreCandidate,
  searchAllSources,
  sha256,
  sha256Text,
  tokenSet,
  type DownloadedPicture,
  type RetrieveForScenesOptions,
  type SearchOptions,
} from "./retrieve.js";

export {
  buildMatchMessages,
  ImageSourceMatchError,
  matchSceneSources,
  type MatchCandidate,
  type SceneCandidates,
} from "./match.js";

export {
  ATTRIBUTION_FILENAME,
  clearSceneSource,
  HISTORICAL_FILENAME,
  readAllSceneSources,
  readSceneSource,
  sceneSourcePath,
  shortAuthor,
  sourceLogLine,
  writeAttributionFile,
  writeHistoricalSummaryFile,
  writeSceneSource,
  type SceneSourceRecord,
} from "./attribution.js";

export {
  CommonsPictureSource,
  parseCommonsResponse,
  type CommonsPictureSourceOptions,
} from "./sources/commons.js";

export {
  commonsFileTitle,
  parseCommonsTitleResponse,
  WikipediaPictureSource,
  type WikipediaPictureSourceOptions,
} from "./sources/wikipedia.js";

export {
  ArtifactPictureSource,
  type ArtifactPictureSourceOptions,
} from "./sources/artifacts.js";

export {
  MetPictureSource,
  OpenversePictureSource,
  parseMetObject,
  parseOpenverseResults,
  parseSmithsonianObject,
  SmithsonianPictureSource,
  type MetPictureSourceOptions,
  type OpenversePictureSourceOptions,
  type SmithsonianPictureSourceOptions,
} from "./sources/museum.js";

export {
  defaultPictureSources,
  type DefaultPictureSourcesOptions,
} from "./sources.js";
