import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@vf/vdsl": path.resolve("packages/vdsl/src"),
      "@vf/video-components": path.resolve("packages/video-components/src"),
      "@vf/media": path.resolve("packages/media/src"),
      "@vf/workflow": path.resolve("packages/workflow/src"),
      "@vf/llm": path.resolve("packages/llm/src"),
      "@vf/agent-storyboard": path.resolve("packages/agent-storyboard/src"),
      "@vf/research": path.resolve("packages/research/src"),
      "@vf/script": path.resolve("packages/script/src"),
      "@vf/tts": path.resolve("packages/tts/src"),
      "@vf/review": path.resolve("packages/review/src"),
      "@vf/youtube": path.resolve("packages/youtube/src"),
      "@vf/media-generators": path.resolve("packages/media-generators/src"),
      "@vf/audio-assets": path.resolve("packages/audio-assets/src"),
      "@vf/audio-mix": path.resolve("packages/audio-mix/src"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
  },
});
