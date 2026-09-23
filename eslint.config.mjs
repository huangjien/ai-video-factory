// @ts-check
import eslint from "@eslint/js";
import globals from "globals";

/**
 * Base ESLint config. We previously used `typescript-eslint` for type-aware
 * linting, but `typescript-eslint@8.70.x` does not yet support TypeScript
 * 7.x (see typescript-eslint/typescript-eslint#10940). This config trades
 * type-aware rules for the base JS ruleset so `pnpm run lint` runs on TS 7
 * without waiting for upstream. Re-introduce `typescript-eslint` once it
 * supports TS 7.
 */
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.tsbuildinfo",
      ".omo/**",
      "projects/**",
    ],
  },
  eslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
];
