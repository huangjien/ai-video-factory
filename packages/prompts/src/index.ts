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
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

/** One entry of the curated BGM library (`assets/bgm/<tag>.<ext>`).
 *
 *  The measurements are real: `duration_sec` from ffprobe, `loudness_lufs_i`
 *  and `dynamic_range_lu` from `ffmpeg -af ebur128`. They are here because
 *  two of them change the choice, and a filename does not tell you either:
 *
 *  - `loudness_lufs_i` spans ~8 dB across the library while the mixer
 *    applies ONE fixed bed attenuation (-18 dB by default), so a quiet
 *    master lands several dB under the narration and a loud one swamps it.
 *  - `dynamic_range_lu` above ~8 means the track breathes, so the bed
 *    swells in the gaps between narration.
 *  - `needs_loop_under_300s` marks tracks shorter than a typical runtime,
 *    which loop with an audible seam unless the track ends cleanly.
 */
export interface BgmCatalogueEntry {
  track: string;
  artist: string;
  /** File name inside `assets/bgm/`. */
  file: string;
  duration_sec: number;
  loudness_lufs_i: number;
  dynamic_range_lu: number;
  /** Scenario guidance for the audio planner. */
  use_when: string;
  avoid_when: string;
  needs_loop_under_300s: boolean;
  quiet_master: boolean;
  wide_dynamics: boolean;
  note?: string;
}

export type BgmCatalogue = Record<string, BgmCatalogueEntry>;

/** `music.json` — the curated BGM library index: tag → entry. Replaces the
 *  old tag → generation-prompt map, which only existed to feed the
 *  (now removed) music-generation API. The optional `dirOverride`
 *  exists for tests that need to exercise the integrity check against
 *  a sandbox copy of the catalogue. */
export function loadBgmCatalogue(dirOverride?: string): BgmCatalogue {
  return loadStructured(
    "music.json",
    (text) => JSON.parse(text) as BgmCatalogue,
    dirOverride,
  );
}

/** Audio extensions the curated library accepts. Mirrors
 *  `FileBasedAudioAssetProvider` in @video/audio-assets — keep both
 *  lists in sync, otherwise `provider` and `catalogue` will disagree
 *  on what counts as a real track. */
export const BGM_TRACK_EXTENSIONS = [".wav", ".mp3", ".m4a"] as const;

/** Path resolution for the curated BGM library on disk. The library
 *  lives at `<repoRoot>/assets/bgm/`. Caller should pass the repo
 *  root explicitly; if omitted we walk up from the prompts package
 *  looking for the first directory that has a `package.json` with
 *  `{ workspaces: [...] }` — that is the monorepo root and the
 *  conventional location of the curated library. */
export function resolveBgmDirectory(repoRoot?: string): string {
  const root = repoRoot ?? findRepoRoot();
  return path.join(root, "assets", "bgm");
}

/** Walk up from the prompts package looking for the monorepo root.
 *  The pnpm convention is a `pnpm-workspace.yaml` next to the root
 *  `package.json` — that marker names the repo unambiguously. Returns
 *  undefined leaves the caller with `assets/bgm/` read against the CWD
 *  (the right answer for tools run from the repo root). */
function findRepoRoot(): string {
  let dir = path.resolve(promptsDir(), "..", "..", "..");
  for (let i = 0; i < 6; i++) {
    const workspaceYaml = path.join(dir, "pnpm-workspace.yaml");
    const pkg = path.join(dir, "package.json");
    if (existsSync(workspaceYaml) && existsSync(pkg)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back: the directory two levels above the prompts prompt files
  // — the conventional `packages/<this>` install layout when the
  // package is consumed outside the monorepo.
  return path.resolve(promptsDir(), "..", "..", "..");
}

/** Drift report from `validateBgmCatalogue`. Pure data — no console
 *  output, no fs writes. The CLI composes a human-readable warning from
 *  these buckets at startup so a missing track doesn't surface mid-mix. */
export interface BgmDriftReport {
  /** Tags in music.json with no matching file on disk. These will
   *  resolve to "tag not found" at mix time. */
  catalogueOrphans: string[];
  /** Files in assets/bgm/ with no entry in music.json. These never
   *  reach the LLM planner because the catalogue drives its prompt. */
  filesystemOrphans: string[];
}

/** Cross-check `music.json` against `assets/bgm/`. Returns the catalogue
 *  plus a drift report. Pure — no logging, no side effects — so the
 *  caller can decide whether to warn, fail, or keep going.
 *
 *  Use this at startup (CLI entry) or before audio-plan fills its
 *  prompt, NOT inside a hot path. Reads fs twice (catalogue JSON and
 *  library directory). `catalogueDirOverride` lets tests inject a
 *  sandbox copy of `music.json`. */
export function loadAndValidateBgmCatalogue(
  repoRoot?: string,
  catalogueDirOverride?: string,
): { catalogue: BgmCatalogue; drift: BgmDriftReport } {
  const catalogue = loadBgmCatalogue(catalogueDirOverride);
  const libDir = resolveBgmDirectory(repoRoot);
  const filesOnDisk = new Set<string>();
  if (existsSync(libDir)) {
    for (const entry of readdirSync(libDir)) {
      const ext = path.extname(entry).toLowerCase();
      if (
        (BGM_TRACK_EXTENSIONS as readonly string[]).includes(ext)
      ) {
        filesOnDisk.add(entry.slice(0, -ext.length));
      }
    }
  }
  const catalogueKeys = new Set(Object.keys(catalogue));
  const catalogueOrphans = [...catalogueKeys].filter(
    (tag) => !filesOnDisk.has(tag),
  );
  const filesystemOrphans = [...filesOnDisk].filter(
    (tag) => !catalogueKeys.has(tag),
  );
  return {
    catalogue,
    drift: {
      catalogueOrphans: catalogueOrphans.sort(),
      filesystemOrphans: filesystemOrphans.sort(),
    },
  };
}

/** Default BGM tag — the one the audio-plan agent picks when nothing in
 *  the article specifically suggests another mood. Lives here (not in
 *  `music.json` or in any agent) so it stays a single source of truth:
 *  the audio-plan prompt fills it in, the CLI's agent-ask falls back to
 *  it, and the runtime resolver confirms the file exists. If this is
 *  `null` or an unregistered tag, both fallbacks will pick the first
 *  track alphabetically from the validated catalogue. */
export const BGM_DEFAULT_TAG = "light-gravity";

/** Render the catalogue as the compact table the audio planner reads.
 *
 *  Deliberately one line per track: the planner needs the scenario, the
 *  two measurements that change the choice, and nothing else. Duration and
 *  loudness are inlined because "does this loop?" and "will this be
 *  audible under the narration?" are the questions a track title cannot
 *  answer.
 */
export function renderBgmCatalogue(catalogue?: BgmCatalogue): string {
  const cat = catalogue ?? loadBgmCatalogue();
  return Object.entries(cat)
    .map(([tag, e]) => {
      const flags = [
        e.needs_loop_under_300s ? "loops under 300s" : null,
        e.quiet_master ? "QUIET master" : null,
        e.wide_dynamics ? "wide dynamics" : null,
      ]
        .filter((f): f is string => f !== null)
        .join(", ");
      const tail = flags.length > 0 ? ` [${flags}]` : "";
      return (
        `- ${tag} — "${e.track}" (${e.artist}), ${e.duration_sec}s, ` +
        `${e.loudness_lufs_i} LUFS, ${e.dynamic_range_lu} LU${tail}\n` +
        `    use when: ${e.use_when}\n` +
        `    avoid when: ${e.avoid_when}` +
        (e.note !== undefined ? `\n    note: ${e.note}` : "")
      );
    })
    .join("\n");
}

function loadStructured<T>(
  file: string,
  parse: (text: string) => T,
  /** Override the directory `file` is read from. Tests pass a sandbox
   *  root here so the `loadAndValidateBgmCatalogue` integrity check
   *  can be exercised with a hand-crafted catalogue without touching
   *  the real `packages/prompts/prompts/music.json` on disk. */
  dirOverride?: string,
): T {
  const cachedKey = dirOverride ? `${dirOverride}::${file}` : file;
  const hit = structuredCache.get(cachedKey) as T | undefined;
  if (hit !== undefined) {
    return hit;
  }
  const dir = dirOverride ?? promptsDir();
  const value = parse(readFileSync(path.join(dir, file), "utf8"));
  structuredCache.set(cachedKey, value);
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
