/**
 * The decision layer's runtime — mode, provider choice, quota visibility,
 * log location. It lives in @video/llm (not in @video/draft) because more
 * than one domain package wires a decision surface: the draft loop owns
 * visual-class and draft-bar, the QA command owns qa-triage — and a
 * lower-level package must not depend on a higher one for its own
 * runtime.
 */
import { MiniMaxDecisionProvider } from "./minimax.js";
import { OpenAIDecisionProvider } from "./openai.js";
import type { DecisionProvider } from "./contract.js";

export type DecisionMode = "off" | "shadow" | "on";

/** The mode from the environment. Default **`on`** — the bench gate
 *  cleared on 2026-11-14 (0.924 ≥ 0.9, brier 0.000), so every wired
 *  surface consults the decision provider and records the answers
 *  beside the baselines. `on` and `shadow` behave identically today —
 *  both record, nothing acts — and the env var exists for the day an
 *  acting surface ships, and for turning the layer off (`off`) without
 *  a code change. The vitest global setup pins `off` so the suite
 *  stays hermetic. */
export function resolveDecisionMode(
  env: NodeJS.ProcessEnv = process.env,
): DecisionMode {
  const raw = (env["DECISION_MODE"] ?? "on").trim().toLowerCase();
  if (raw === "off" || raw === "shadow" || raw === "on") return raw;
  throw new Error(
    `unknown DECISION_MODE "${raw}" — expected off | shadow | on`,
  );
}

export interface CreateDecisionProviderOptions {
  provider?: string | undefined;
  model?: string | undefined;
}

/** The provider the layer consults. Default: the OpenAI Decisions API —
 *  the bench's winner on every measured axis (§15 of the plan doc). */
export function createDecisionProvider(
  opts: CreateDecisionProviderOptions = {},
): DecisionProvider {
  const name = (opts.provider ?? "openai").trim().toLowerCase();
  if (name === "openai") {
    return new OpenAIDecisionProvider(
      opts.model !== undefined ? { model: opts.model } : {},
    );
  }
  if (name === "minimax") {
    return new MiniMaxDecisionProvider(
      opts.model !== undefined ? { model: opts.model } : {},
    );
  }
  throw new Error(`unknown decision provider "${name}" — openai | minimax`);
}

/** True for an error that means "the provider's quota/rate limit is
 *  exhausted" — as opposed to a one-off timeout or a malformed answer.
 *  MiniMax's monthly plan returns 429 with error 2056 when the month's
 *  budget is spent; the layer degrades either way, but the operator
 *  should know WHICH degradation they are looking at. */
export function isQuotaError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /429|rate.?limit|usage limit|quota/i.test(message);
}

/** Print one stderr line when consults hit the provider's quota. The
 *  layer keeps running (the deterministic path never needed the
 *  provider), but a silent stop of the shadow log looks like a bug —
 *  this says what it is. */
export function warnIfQuotaExhausted(
  errors: (string | null | undefined)[],
): void {
  if (errors.some((e) => isQuotaError(e))) {
    console.error(
      "  ! decision provider quota/rate limit exhausted — the shadow pass degraded to the deterministic path for the affected calls",
    );
  }
}

/** Where a project's decision log lives. Every surface appends to the
 *  same file and tells each other apart by the `surface` field. */
export function decisionLogPath(projectRoot: string): string {
  return `${projectRoot}/decision-log.jsonl`;
}
