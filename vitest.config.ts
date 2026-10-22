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
      "@video/bilibili": path.resolve("packages/bilibili/src"),
      "@video/media-generators": path.resolve("packages/media-generators/src"),
      "@video/audio-assets": path.resolve("packages/audio-assets/src"),
      "@video/audio-mix": path.resolve("packages/audio-mix/src"),
      "@video/motion": path.resolve("packages/motion/src"),
      "@video/qa": path.resolve("packages/qa/src"),
      "@video/prompts": path.resolve("packages/prompts/src"),
      "@video/draft": path.resolve("packages/draft/src"),
      "@video/make": path.resolve("packages/make/src"),
      "@video/audio-plan": path.resolve("packages/audio-plan/src"),
      "@video/video-renderer": path.resolve("packages/video-renderer/src"),
      "@video/learn": path.resolve("packages/learn/src"),
      "@video/cli": path.resolve("packages/cli/src"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
    // v0.11.2: a 30-s per-test timeout catches hangs on slow CI runners
    // (a 2-core Linux box + chromium-pending processes can stall a fork
    // past 5 min when the local-server mock never resolves). The hook
    // was a previous CI timeout, so the test now errors out instead of
    // timing out the whole job. Local runs on macOS complete every
    // test well under 5 s.
    testTimeout: 30_000,
    // Hermetic agent env for the whole suite (see file header) — a
    // harness-running-vitest session must not change CLI behavior.
    globalSetup: ["./vitest-global-setup.ts"],
    // Use forks (one process per test file) instead of the default thread
    // pool. Integration tests under packages/cli/src spin up local HTTP
    // servers and mutate process.env (GLM_BASE_URL, MINIMAX_API_HOST).
    // Under threads, concurrent files share the same Node process —
    // undici's connection pool and the shared env cause intermittent
    // 'fetch failed' in CI (Ubuntu/Node 22) even though they pass locally
    // (macOS/Node 26). Forks isolate each file in its own process.
    pool: "forks",
    // Hermetic voicebox probe: runDraft's pre-flight must never see a
    // developer's live local server, or the conditional tts question
    // appears and every ask-envelope assertion becomes machine-dependent.
    // Port 9 (discard) refuses instantly.
    env: { VOICEBOX_URL: "http://127.0.0.1:9" },
    poolOptions: {
      forks: {
        // One fork per CPU by default; cap at 4 to avoid resource spikes
        // on small CI runners.
        maxForks: 4,
      },
    },
    // Enabled in config (not just via `pnpm test`'s --coverage flag) so
    // scoped runs — `pnpm vitest run packages/<name>` — end with the
    // coverage table too. Scoped runs only execute one package, so every
    // other package reports 0%: read the rows for the package under test.
    coverage: {
      enabled: true,
      // Print the coverage table even when tests fail — a red suite still
      // needs its coverage numbers at the end (default hides them).
      reportOnFailure: true,
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/index.ts", "**/dist/**"],
      reporter: ["text", "text-summary"],
      // v8 coverages hit thresholds below; the threshold is intentionally
      // lenient to start — tighten over time as more code is covered.
      // Thresholds LIVE ON THE SCRIPT, not the config. `pnpm test` is the
      // canonical full run — it sets --coverage.thresholds.* so the ratchet
      // (lines 80 / statements 80 / functions 78 / branches 62, ratcheted
      // 2026-10-18) blocks regressions. Scoped runs (e.g.
      // `pnpm vitest run packages/<name> --coverage`) carry no thresholds
      // and report coverage without failing, which is the right answer
      // for partial work where v8's `coverage.all: true` would otherwise
      // count 0%-covered unexercised files against the gate.
      // `**/index.ts` stays excluded — those are pure re-exports; the
      // slightly padded numbers are intentional (a self-reporting metric
      // is worse than a slightly padded one). Tighten incrementally as
      // the suite matures — update the `pnpm test` script in lockstep.
      thresholds: {},
    },
  },
});
