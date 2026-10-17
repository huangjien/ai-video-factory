/**
 * Central prompt registry — every LLM/Laya prompt lives as a file under
 * `packages/prompts/prompts/` and is loaded through here. Source files keep
 * exporting the same `SYSTEM_PROMPT` constants they always did; only the
 * storage moved (inline TS template literal → managed file).
 *
 * Layout: one file per prompt, kebab-case stem (e.g. `storyboard.md`,
 * `image-styles.yaml`, `music.json`). `.md` files hold a single prompt body;
 * the loader strips exactly one trailing newline so file content stays
 * byte-identical to the historical template literals (prompt_hash lineage
 * depends on that).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/** packages/prompts/{src|dist} → ../prompts (same either way). */
function promptsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "prompts");
}

/** Templates historically had no trailing newline; editors add one. */
function stripTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

const cache = new Map<string, string>();

/**
 * Load a `.md` prompt by name (stem only — `loadPrompt("storyboard")` reads
 * `prompts/storyboard.md`). Cached per process. Throws with the absolute
 * path when the file is missing, so a renamed/typo'd name is debuggable
 * from the stack alone.
 */
export function loadPrompt(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const file = path.join(promptsDir(), `${name}.md`);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`prompt file not found: ${file} (name: "${name}")`, {
      cause: err,
    });
  }
  const content = stripTrailingNewline(raw);
  cache.set(name, content);
  return content;
}

/**
 * Replace `{{placeholder}}` tokens in a loaded template. Throws on a token
 * with no provided value — a half-filled prompt reaching the LLM is worse
 * than a loud failure here.
 */
export function fillPrompt(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (token, key: string) => {
    const value = vars[key];
    if (value === undefined) {
      throw new Error(`fillPrompt: no value for placeholder ${token}`);
    }
    return value;
  });
}

/** Absolute path of a prompt file (for `video prompts path`/`show`). */
export function promptFilePath(name: string): string {
  return path.join(promptsDir(), `${name}.md`);
}

/** All registered prompt file names, sorted (extension included). */
export function listPromptFiles(): string[] {
  return readdirSync(promptsDir()).sort();
}

/** Test/inspection hook: names loaded so far in this process. The registry
 *  coverage test (packages/cli/src/prompt-registry.test.ts) imports every
 *  loader site and asserts this equals the files on disk — so an orphan
 *  prompt file (added, never loaded) or a dangling reference (deleted,
 *  still called) fails the suite instead of surfacing at render time. */
export function loadedPromptNames(): string[] {
  return [...cache.keys()].sort();
}

/** Raw file content by exact filename (extension included). `show`-style
 * access for structured files (yaml/json) that `loadPrompt` cannot serve. */
export function readPromptFile(file: string): string {
  return readFileSync(path.join(promptsDir(), file), "utf8");
}

export interface ImageStylePreset {
  /** Extra system rules for the prompt-expanding LLM. */
  systemBlock: string;
  /** Style contract appended verbatim to the final image prompt. */
  promptSuffix: string;
}

const structuredCache = new Map<string, unknown>();

/** `image-styles.yaml` — style → preset map. Each string value is
 * newline-normalized like `loadPrompt`. */
export function loadImageStylePresets(): Record<string, ImageStylePreset> {
  return loadStructured("image-styles.yaml", (text) => {
    const parsed = parseYaml(text) as Record<string, ImageStylePreset>;
    for (const preset of Object.values(parsed)) {
      for (const key of Object.keys(preset) as (keyof ImageStylePreset)[]) {
        preset[key] = stripTrailingNewline(preset[key]);
      }
    }
    return parsed;
  });
}

/** `music.json` — BGM tag → generation prompt (free-text passthrough
 * handles tags not listed, so this map only grows the vocabulary). */
export function loadMusicPrompts(): Record<string, string> {
  return loadStructured(
    "music.json",
    (text) => JSON.parse(text) as Record<string, string>,
  );
}

function loadStructured<T>(file: string, parse: (text: string) => T): T {
  const hit = structuredCache.get(file) as T | undefined;
  if (hit !== undefined) {
    return hit;
  }
  const value = parse(readFileSync(path.join(promptsDir(), file), "utf8"));
  structuredCache.set(file, value);
  return value;
}

export {
  applyRecorded,
  blockLayout,
  buildEnvelope,
  evalSnapshotPath,
  evalsDir,
  listEvalAgents,
  listEvalCases,
  listEvalFiles,
  listSnapshotIds,
  loadEnvelope,
  loadEvalFixture,
  parseEvalFixture,
  renderEnvelopeYaml,
  renderYaml,
  sha256,
  sha256OfMessages,
  type CaseEnvelope,
  type EvalCaseRef,
  type EvalExpectation,
  type EvalFixture,
  type MessageEnvelope,
} from "./evals.js";
