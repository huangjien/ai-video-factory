/**
 * The prompt-file primitives — the cache, the reader, the filler.
 *
 * They live apart from `index.ts` so the decision-question registry can
 * load prompt bodies at import time WITHOUT an import cycle: `index.ts`
 * re-exports this module and the decision registry, and the decision
 * registry imports the loader from here. With the loader inside
 * `index.ts`, that cycle would put `loadPrompt` on the stack while
 * `index.ts` was still evaluating — and the cache it writes to would
 * not exist yet.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** packages/prompts/{src|dist} → ../prompts (same either way). */
export function promptsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "prompts");
}

/** Templates historically had no trailing newline; editors add one. */
export function stripTrailingNewline(text: string): string {
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

