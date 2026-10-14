import { parse as parseYaml } from "yaml";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * lora-config.yaml loader — doc §v0.5 T5 (LoRA conventions).
 *
 * Human-edited file (mirrors audio-config.yaml). Lives at:
 *   - <projectRoot>/lora-config.yaml  (per-project; overrides root)
 *   - <repoRoot>/lora-config.yaml     (workspace default)
 *
 * Schema (v0.5.1 — flat list applied to every image):
 *   loras:
 *     - source: loras/ink-style.safetensors   # path rel to config dir,
 *                                              # absolute path, or HF repo id
 *       scale: 0.8                            # optional, default 1.0
 *       license: loras/ink-style.license.txt  # optional; if set, must exist
 *
 * Resolution order (highest wins, picked by `resolveLoraConfigPath`):
 *   1. FLUX2_LORA_CONFIG env (full absolute yaml path)
 *   2. provider option `loraConfigPath` (absolute yaml path)
 *   3. <projectRoot>/lora-config.yaml
 *   4. <repoRoot>/lora-config.yaml
 * If none resolve, the legacy `FLUX2_LORA` env / `lora` provider option
 * (a "path:scale,path2:scale2" string) is used by the worker.
 */
export interface LoraConfigEntry {
  source: string;
  scale: number;
  /** Absolute path of the license file plus its content, when declared. */
  license?: { path: string; text: string };
}

export interface ResolvedLoraConfig {
  entries: LoraConfigEntry[];
  configPath: string;
  warnings: string[];
}

export class LoraConfigError extends Error {
  constructor(message: string, public readonly configPath: string) {
    super(message);
    this.name = "LoraConfigError";
  }
}

interface RawLoraConfig {
  loras?: unknown;
}

interface RawLoraEntry {
  source?: unknown;
  scale?: unknown;
  license?: unknown;
}

const HF_REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const LOCAL_FILE_EXT_RE = /\.(?:safetensors|bin|pt|gguf|ckpt)$/i;

function isProbablyHfRepoId(source: string): boolean {
  if (source.startsWith("/") || source.startsWith("./") || source.startsWith("../")) {
    return false;
  }
  if (LOCAL_FILE_EXT_RE.test(source.split("/").pop() ?? "")) {
    return false;
  }
  return HF_REPO_RE.test(source);
}

function resolveSource(raw: string, configDir: string): string {
  if (isProbablyHfRepoId(raw)) return raw;
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(configDir, raw);
}

export function loadLoraConfig(configPath: string): ResolvedLoraConfig {
  const abs = path.resolve(configPath);
  if (!existsSync(abs)) {
    throw new LoraConfigError(`lora config not found: ${abs}`, abs);
  }
  let parsed: RawLoraConfig;
  try {
    parsed = (parseYaml(readFileSync(abs, "utf8")) ?? {}) as RawLoraConfig;
  } catch (err) {
    throw new LoraConfigError(
      `lora config is not valid YAML (${abs}): ${(err as Error).message}`,
      abs,
    );
  }
  const configDir = path.dirname(abs);
  const warnings: string[] = [];
  const entries: LoraConfigEntry[] = [];
  if (parsed.loras == null) return { entries, configPath: abs, warnings };
  if (!Array.isArray(parsed.loras)) {
    throw new LoraConfigError(
      `lora config: 'loras' must be an array (${abs})`,
      abs,
    );
  }
  parsed.loras.forEach((raw, idx) => {
    if (typeof raw !== "object" || raw === null) {
      throw new LoraConfigError(
        `lora config: loras[${idx}] must be an object (${abs})`,
        abs,
      );
    }
    const r = raw as RawLoraEntry;
    if (typeof r.source !== "string" || r.source.length === 0) {
      throw new LoraConfigError(
        `lora config: loras[${idx}].source is required (${abs})`,
        abs,
      );
    }
    let scale = 1.0;
    if (r.scale !== undefined) {
      if (typeof r.scale !== "number" || !Number.isFinite(r.scale)) {
        throw new LoraConfigError(
          `lora config: loras[${idx}].scale must be a number (${abs})`,
          abs,
        );
      }
      if (r.scale < 0 || r.scale > 2) {
        warnings.push(
          `loras[${idx}].scale=${r.scale} is outside the typical 0..1.5 range`,
        );
      }
      scale = r.scale;
    }
    const resolved = resolveSource(r.source, configDir);
    const entry: LoraConfigEntry = { source: resolved, scale };
    if (r.license !== undefined) {
      if (typeof r.license !== "string") {
        throw new LoraConfigError(
          `lora config: loras[${idx}].license must be a string path (${abs})`,
          abs,
        );
      }
      const licPath = path.resolve(configDir, r.license);
      if (!existsSync(licPath)) {
        throw new LoraConfigError(
          `lora config: license file missing for loras[${idx}] — ${licPath}`,
          abs,
        );
      }
      entry.license = { path: licPath, text: readFileSync(licPath, "utf8") };
    } else if (!isProbablyHfRepoId(resolved)) {
      warnings.push(
        `loras[${idx}] (${resolved}) has no license sidecar; humans own the licensing check`,
      );
    }
    entries.push(entry);
  });
  return { entries, configPath: abs, warnings };
}

export function resolveLoraConfigPath(opts: {
  envPath?: string | undefined;
  providerPath?: string | undefined;
  projectRoot: string;
  repoRoot: string;
}): string | undefined {
  if (opts.envPath) {
    const abs = path.resolve(opts.envPath);
    if (existsSync(abs)) return abs;
  }
  if (opts.providerPath) {
    const abs = path.resolve(opts.providerPath);
    if (existsSync(abs)) return abs;
  }
  const candidates = [
    path.join(opts.projectRoot, "lora-config.yaml"),
    path.join(opts.repoRoot, "lora-config.yaml"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}
