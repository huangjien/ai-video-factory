/**
 * Vitest globalSetup (2026-10-16): scrub live agent-harness markers from
 * process.env so the whole suite is hermetic regardless of where
 * `pnpm test` runs.
 *
 * Why: `video draft`'s agent-ask gate (v0.7, video-ask/1) detects the
 * enclosing harness from env markers. When vitest runs INSIDE a harness
 * (e.g. opencode exports OPENCODE_PID to every child), draft tests
 * started exiting 2 — "questions pending" — instead of proceeding. Tests
 * that want an agent env stub markers explicitly (agent-ask.test.ts);
 * the suite default must be "no harness".
 *
 * Deletes every detector marker plus VIDEO_ASK/VIDEO_ASK_ENV overrides.
 * Runs once per vitest invocation, before any test file.
 */

const HARNESS_MARKERS = [
  "ZCODE_APP_VERSION",
  "CLAUDECODE",
  "OPENCODE_PID",
  "OMO_CODING_AGENT_DIR",
  "OMP_CODING_AGENT_DIR",
  "PI_CODING_AGENT_DIR",
  "VIDEO_ASK",
  "VIDEO_ASK_ENV",
] as const;

export default function setup(): void {
  for (const name of HARNESS_MARKERS) {
    delete process.env[name];
  }
}
