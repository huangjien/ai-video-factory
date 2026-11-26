// @ts-check
import eslint from "@eslint/js";
import globals from "globals";

/**
 * Base ESLint config. We previously used `typescript-eslint` for type-aware
 * linting, but `typescript-eslint@8.71.x` still caps its peer dep at
 * `typescript <6.1.0` (TS 7 unsupported — see
 * typescript-eslint/typescript-eslint#10940). This config trades
 * type-aware rules for the base JS ruleset so `pnpm run lint` runs on TS 7
 * without waiting for upstream. The decision and trigger conditions
 * (re-evaluate 2026-12-31) are in docs/roadmap/typescript-eslint-ts7.md —
 * re-introduce `typescript-eslint` per that plan once it supports TS 7.
 */
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      // The packed CLI bundle (scripts/build-bundle.mjs) — build output
      // like dist/, and git-ignored. Linting a 1.3 MB bundle only reports
      // the compiled form of source issues.
      "**/dist-bundle/**",
      "**/*.tsbuildinfo",
      ".omo/**",
      "projects/**",
      // Local run records and scratch scripts (git-ignored): the judge
      // snapshots, auto-producer logs and one-off .mjs analysis helpers
      // that live next to them.
      "runs/**",
      // Third-party agent skills ship their own code style (T0.2).
      ".agents/**",
      ".claude/**",
      // Python venvs (uv) — third-party JS bundles inside shouldn't be
      // linted.
      "**/.venv/**",
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
