import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod/v3";

/** Per-role provider routing (doc §6 lines 205-247).
 * The storyboard role defaults to minimax (primary) → glm (fallback) — the
 * exact example shown in §6. The defaults live in `config/llm.yaml`; override
 * via the `LL_CONFIG` env var pointing at another YAML file.
 */
export type Role =
  "research" | "script" | "storyboard" | "visual" | "motion" | "review";

export interface ProviderRef {
  primary: string;
  fallback?: string | undefined;
}

export type ProviderConfig = Record<Role, ProviderRef>;

// Keep the historical default for installations with older config files.
export const GENERATOR_POOL = ["openai", "gemini", "glm"] as const;
export type GeneratorName = (typeof GENERATOR_POOL)[number];

/** Where a model id lives in the config: `models.<kind>.<provider>`. */
export const MODEL_KINDS = [
  "chat",
  "decision",
  "image",
  "video",
  "tts",
] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

/** The routing, model IDs, and draft settings supplied by one config file. */
export interface LlmConfig {
  roles: Partial<ProviderConfig>;
  models: Partial<Record<ModelKind, Record<string, string>>>;
  draft?: { generator_pool: GeneratorName[] } | undefined;
}

const ROLE_NAMES = [
  "research",
  "script",
  "storyboard",
  "visual",
  "motion",
  "review",
] as const satisfies readonly Role[];

/** `config/llm.yaml`, validated once at the boundary. An unknown kind, a
 *  role without a primary, or a blank model id is a parse failure — the
 *  file is hand-edited, and a half-trusted config is worse than a stop. */
const configFileSchema = z.object({
  roles: z
    .record(
      z.enum(ROLE_NAMES),
      z.object({
        primary: z.string().trim().min(1),
        fallback: z.string().trim().min(1).optional(),
      }),
    )
    .optional(),
  models: z
    .record(z.enum(MODEL_KINDS), z.record(z.string().trim().min(1)))
    .optional(),
  draft: z.object({
    generator_pool: z.array(z.enum(GENERATOR_POOL)).nonempty().refine(
      (providers) => new Set(providers).size === providers.length,
      "Provider names must be unique",
    ),
  }).optional(),
});

/** The original shape put the role names at the top level; such a file
 *  still parses, as roles only. An empty file is an empty config. */
const configSchema = z.preprocess((value) => {
  if (value === null) return {};
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !("roles" in value) &&
    !("models" in value) &&
    !("draft" in value)
  ) {
    return { roles: value };
  }
  return value;
}, configFileSchema);

/** The last-resort routing, used only when no config file can be found
 *  at all. Model ids have no built-in copy — `config/llm.yaml` is their
 *  only source, so a model change can never leave a stale duplicate. */
const DEFAULT_CONFIG: ProviderConfig = {
  research: { primary: "glm", fallback: "minimax" },
  script: { primary: "minimax", fallback: "glm" },
  storyboard: { primary: "minimax", fallback: "glm" },
  visual: { primary: "minimax", fallback: "glm" },
  motion: { primary: "minimax", fallback: "glm" },
  review: { primary: "glm", fallback: "minimax" },
};

/** The repository's `config/llm.yaml`, found from this module's own
 *  location. Two layouts: the workspace (`packages/llm/{src,dist}` →
 *  `../../../config`, three levels up to the repository root) and the
 *  published single-file bundle (the file ships under `assets/config/`).
 *  Null when neither exists. */
export function repoConfigPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "..", "..", "config", "llm.yaml"),
    path.resolve(here, "assets", "config", "llm.yaml"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** The override file: a path handed to the loader, else `LL_CONFIG`.
 *  A path that does not exist is ignored (same rule as before). */
function overrideConfigPath(explicit: string | undefined): string | null {
  const file = explicit ?? process.env["LL_CONFIG"];
  return file !== undefined && file !== "" && existsSync(file) ? file : null;
}

/** Read and validate one config file. Missing → null, so the next source
 *  applies. Present but malformed → throws naming the offending key: a
 *  config nobody can trust must not be applied in part. */
function readConfig(file: string): LlmConfig | null {
  if (!existsSync(file)) return null;
  const parsed = configSchema.safeParse(parseYaml(readFileSync(file, "utf8")));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(
        (issue) => `${issue.path.join(".") || "(top level)"}: ${issue.message}`,
      )
      .join("; ");
    throw new Error(`LLM config file is invalid — ${file}: ${issues}`);
  }
  return {
    roles: parsed.data.roles ?? {},
    models: parsed.data.models ?? {},
    draft: parsed.data.draft,
  };
}

/** The repository file, then the override file on top of it — an override
 *  replaces only the keys it names. */
function mergedConfig(explicit: string | undefined): LlmConfig {
  const base = repoConfigPath();
  const baseParsed = base === null ? null : readConfig(base);
  const override = overrideConfigPath(explicit);
  const overrideParsed = override === null ? null : readConfig(override);
  const models: Partial<Record<ModelKind, Record<string, string>>> = {};
  for (const source of [baseParsed?.models, overrideParsed?.models]) {
    for (const kind of MODEL_KINDS) {
      if (source?.[kind] !== undefined) {
        models[kind] = { ...(models[kind] ?? {}), ...source[kind] };
      }
    }
  }
  return {
    roles: { ...(baseParsed?.roles ?? {}), ...(overrideParsed?.roles ?? {}) },
    models,
    draft: overrideParsed?.draft ?? baseParsed?.draft,
  };
}

export function loadProviderConfig(configPath?: string): ProviderConfig {
  return { ...DEFAULT_CONFIG, ...mergedConfig(configPath).roles };
}

export function loadDraftGeneratorPool(): readonly GeneratorName[] {
  return mergedConfig(undefined).draft?.generator_pool ?? GENERATOR_POOL;
}

/** Every model id in effect, by kind and provider. */
export function loadModelConfig(configPath?: string): LlmConfig["models"] {
  return mergedConfig(configPath).models;
}

/** The model id a provider serves by default. Throws when the config has
 *  no entry: there is no built-in copy to fall back to, and a run that
 *  silently used a stale hard-coded id would be worse than a loud stop. */
export function defaultModel(kind: ModelKind, provider: string): string {
  const id = loadModelConfig()[kind]?.[provider];
  if (id === undefined) {
    throw new Error(
      `no model id for ${kind}/${provider} — add it under models.${kind} in ${repoConfigPath() ?? "config/llm.yaml"}`,
    );
  }
  return id;
}

/** The model id to write in a RUN RECORD. Never throws: a record is
 *  metadata, and failing to name a model must not fail the step it
 *  describes. An unresolvable provider is recorded as `unknown` — the
 *  honest value — where `defaultModel` would stop. Use this only for
 *  records; an API call needs the strict one. */
export function modelLabel(
  kind: ModelKind,
  provider: string | undefined,
): string {
  if (provider === undefined) return "unknown";
  return loadModelConfig()[kind]?.[provider] ?? "unknown";
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
