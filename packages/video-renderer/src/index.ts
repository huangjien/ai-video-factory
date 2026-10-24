export { Root } from "./Root.js";
export type { RootProps } from "./Root.js";
export {
  concatScenes,
  faststart,
  renderPlanToVideo,
  renderSceneToVideo,
} from "./render.js";
export { prepareStudioWorkspace, type StudioWorkspace } from "./studio.js";
export {
  loadOrCompileStoryboard,
  mergeBrandConfig,
  renderPreviewProject,
  type IncrementalRenderResult,
  type PreviewOutcome,
} from "./pipeline.js";
export {
  readSceneCacheMeta,
  sceneCacheFile,
  sceneCacheIsFresh,
  sceneFileName,
  sceneImageDigest,
  scenesDirFor,
  writeSceneCacheMeta,
  RENDERER_REVISION,
  type SceneCacheMeta,
  type SceneCacheTerms,
} from "./scene-cache.js";
