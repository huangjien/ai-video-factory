import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

/** Per-role provider routing (doc §6 lines 205-247).
 * The storyboard role defaults to minimax (primary) → glm (fallback) — the
 * exact example shown in §6. Override via a YAML file (e.g. `llm.config.yaml`)
 * or the `LL_CONFIG` env var pointing at one.
 */
export type Role =
  "research" | "script" | "storyboard" | "visual" | "motion" | "review";

export interface ProviderRef {
  primary: string;
  fallback?: string | undefined;
}

export type ProviderConfig = Record<Role, ProviderRef>;

const DEFAULT_CONFIG: ProviderConfig = {
  research: { primary: "glm", fallback: "minimax" },
  script: { primary: "minimax", fallback: "glm" },
  storyboard: { primary: "minimax", fallback: "glm" },
  visual: { primary: "minimax", fallback: "glm" },
  motion: { primary: "minimax", fallback: "glm" },
  review: { primary: "glm", fallback: "minimax" },
};

export function loadProviderConfig(configPath?: string): ProviderConfig {
  const path = configPath ?? process.env["LL_CONFIG"];
  if (!path || !existsSync(path)) return DEFAULT_CONFIG;
  const raw = readFileSync(path, "utf8");
  const parsed = parseYaml(raw) as Partial<ProviderConfig> | null;
  if (!parsed || typeof parsed !== "object") return DEFAULT_CONFIG;
  return { ...DEFAULT_CONFIG, ...parsed };
}

export function providerForRole(
  cfg: ProviderConfig,
  role: Role,
  preferred?: string | undefined,
): string {
  if (preferred === "minimax" || preferred === "glm") return preferred;
  return cfg[role].primary;
}

/** Result of the judge/generator pairing rule — see `pickJudgeProvider`. */
export interface JudgePick {
  /** Provider to call the judge with — guaranteed ≠ the generator unless
   *  the whole config collapsed to one provider. */
  name: string;
  /** Fallback for the judge call — the other review-role slot. May equal
   *  the generator: with two providers it always does, and judging on the
   *  generator after a judge OUTAGE beats shipping unreviewed. The pairing
   *  guarantee is about the primary choice, not the disaster path. */
  fallback: string | undefined;
  /** True when the review primary collided with the generator and the
   *  rule flipped to the fallback. Callers surface this as a warning. */
  flipped: boolean;
}

/** Cross-model judging pairing rule (2026-10-26 design,
 *  docs/plans/2026-10-26-cross-model-judging-design.md): a judge must
 *  grade with a DIFFERENT provider than the one that generated the
 *  artifact. Judge slots come from the `review` role; with only two
 *  providers no static default can avoid every collision, so when the
 *  review primary equals the generator the rule flips to the role's
 *  fallback. When both slots equal the generator (single-provider
 *  setup) the primary is kept — callers must warn loudly that scoring
 *  is self-judged. Deterministic code, never an LLM decision. */
export function pickJudgeProvider(
  cfg: ProviderConfig,
  generatorName: string,
): JudgePick {
  const role = cfg["review"];
  let name = role.primary;
  let flipped = false;
  if (
    name === generatorName &&
    role.fallback &&
    role.fallback !== generatorName
  ) {
    name = role.fallback;
    flipped = true;
  }
  const other = name === role.primary ? role.fallback : role.primary;
  const fallback = other && other !== name ? other : undefined;
  return { name, fallback, flipped };
}

/** Build a JudgePick from an explicit judge name (a `--judge-model` style
 *  CLI override). The fallback is the other review-role slot when distinct
 *  — same outage policy as `pickJudgeProvider`. */
export function judgePickForName(name: string, cfg: ProviderConfig): JudgePick {
  const role = cfg["review"];
  const other = name === role.primary ? role.fallback : role.primary;
  const fallback = other && other !== name ? other : undefined;
  return { name, fallback, flipped: false };
}
