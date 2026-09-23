export {
  TTSError,
  type TTSProvider,
  type TTSRequest,
  type TTSResult,
  type TTSWord,
} from "./provider.js";
export {
  EdgeTTSProvider,
  mockEdgeTTSProvider,
  type EdgeTTSProviderOptions,
  type MockEdgeTTSOptions,
} from "./edge-tts.js";
export { FakeTTSProvider, type FakeTTSOptions } from "./fake.js";
