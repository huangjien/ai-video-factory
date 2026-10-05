export {
  AssetResultSchema,
  AudioAssetError,
  BgmOptionsSchema,
  SfxOptionsSchema,
  type AssetResult,
  type AudioAssetProvider,
  type BgmOptions,
  type SfxOptions,
} from "./schemas.js";
export {
  FileBasedAudioAssetProvider,
  MockAudioAssetProvider,
} from "./providers.js";
export {
  MiniMaxMusicProvider,
  MUSIC_PROMPTS,
  type MiniMaxMusicProviderOptions,
} from "./minimax-music.js";
