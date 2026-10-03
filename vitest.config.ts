import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@video/vdsl": path.resolve("packages/vdsl/src"),
      "@video/video-components": path.resolve("packages/video-components/src"),
      "@video/media": path.resolve("packages/media/src"),
      "@video/workflow": path.resolve("packages/workflow/src"),
      "@video/llm": path.resolve("packages/llm/src"),
      "@video/agent-storyboard": path.resolve("packages/agent-storyboard/src"),
      "@video/research": path.resolve("packages/research/src"),
      "@video/script": path.resolve("packages/script/src"),
      "@video/tts": path.resolve("packages/tts/src"),
      "@video/review": path.resolve("packages/review/src"),
      "@video/youtube": path.resolve("packages/youtube/src"),
      "@video/media-generators": path.resolve("packages/media-generators/src"),
      "@video/audio-assets": path.resolve("packages/audio-assets/src"),
      "@video/audio-mix": path.resolve("packages/audio-mix/src"),
      "@video/motion": path.resolve("packages/motion/src"),
      "@video/qa": path.resolve("packages/qa/src"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
    // Use forks (one process per test file) instead of the default thread
    // pool. Integration tests under packages/cli/src spin up local HTTP
    // servers and mutate process.env (GLM_BASE_URL, MINIMAX_API_HOST).
    // Under threads, concurrent files share the same Node process —
    // undici's connection pool and the shared env cause intermittent
    // 'fetch failed' in CI (Ubuntu/Node 22) even though they pass locally
    // (macOS/Node 26). Forks isolate each file in its own process.
    pool: "forks",
    poolOptions: {
      forks: {
        // One fork per CPU by default; cap at 4 to avoid resource spikes
        // on small CI runners.
        maxForks: 4,
      },
    },
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/index.ts", "**/dist/**"],
      reporter: ["text", "text-summary"],
      // v8 coverages hit thresholds below; the threshold is intentionally
      // lenient to start — tighten over time as more code is covered.
      thresholds: { lines: 0, functions: 0, branches: 0, statements: 0 },
    },
  },
});
