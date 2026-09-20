import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

/** Per-role provider routing (doc §6 lines 205-247).
 * The storyboard role defaults to minimax (primary) → glm (fallback) — the
 * exact example shown in §6. Override via a YAML file (e.g. `llm.config.yaml`)
 * or the `LL_CONFIG` env var pointing at one.
 */
export type Role = "research" | "script" | "storyboard" | "visual" | "review";

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
