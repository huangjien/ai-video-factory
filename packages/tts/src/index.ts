export {
  TTSError,
  type TTSProvider,
  type TTSRequest,
  type TTSResult,
  type TTSWord,
} from "./provider.js";
export {
  EdgeTTSProvider,
  splitSentences,
  type EdgeTTSProviderOptions,
} from "./edge-tts.js";
export { FakeTTSProvider, type FakeTTSOptions } from "./fake.js";
