import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@vf/vdsl": path.resolve("packages/vdsl/src"),
      "@vf/video-components": path.resolve("packages/video-components/src"),
      "@vf/media": path.resolve("packages/media/src"),
      "@vf/workflow": path.resolve("packages/workflow/src"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
  },
});
