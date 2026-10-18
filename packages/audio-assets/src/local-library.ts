import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { probeAudioDurationOrNull } from "@video/media";
import { AudioAssetError } from "./schemas.js";

/** A single entry in the curated local BGM library. */
export interface LocalBgmEntry {
  /** Tag (filename minus extension). Unique within a library. */
  tag: string;
  /** Mood / type label inferred from the tag prefix (everything before
   *  the first `-`). Lets `pickByMood` choose the right mood without a
   *  separate index. */
  mood: string;
  /** Absolute path to the audio file. */
  path: string;
  /** Probe result — null when ffprobe is missing or fails (the
   *  `bgm-timeline` step re-probes). */
  durationSec: number | null;
}

/** The curated BGM library lives at `<repo>/assets/bgm/` — single source of
 *  truth for royalty-free tracks that pass through every project's mix
 *  pipeline. Generic by intent: any directory matching the same shape
 *  (one audio file + one optional `<stem>.license.txt` per tag) can be
 *  loaded the same way. */
export function curatedBgmDirectory(repoRoot: string): string {
  return path.join(repoRoot, "assets", "bgm");
}

/** Read one curated BGM directory. Returns entries sorted by mood then
 *  tag so consumers see a stable order. Skips files whose extension is
 *  not in the audio provider's accepted list. */
export function loadLocalBgmLibrary(directory: string): LocalBgmEntry[] {
  if (!existsSync(directory)) return [];
  const tags = new Set<string>();
  const out: LocalBgmEntry[] = [];
  for (const file of readdirSync(directory).sort()) {
    // `*.silent.wav` are the placeholders `video make` writes for
    // unresolvable tags — never legitimate library audio. Skipping them
    // here AND in the resolver is what keeps a one-time miss from
    // permanently shadowing the real library lookup.
    if (file.endsWith(".silent.wav")) continue;
    const ext = path.extname(file).toLowerCase();
    if (ext !== ".wav" && ext !== ".mp3" && ext !== ".m4a") continue;
    const tag = file.slice(0, -ext.length);
    if (tags.has(tag)) continue; // skip sibling .license.txt siblings
    tags.add(tag);
    const dashIdx = tag.indexOf("-");
    out.push({
      tag,
      mood: dashIdx > 0 ? tag.slice(0, dashIdx) : "uncategorized",
      path: path.join(directory, file),
      durationSec: null,
    });
  }
  return out;
}

/** Probe a list of files in parallel. Failures (ffprobe missing, bad
 *  file) yield `null` — the entry's existing `durationSec` stays
 *  unchanged on a partial failure. */
export async function probeLibrary(
  entries: LocalBgmEntry[],
): Promise<LocalBgmEntry[]> {
  const results = await Promise.all(
    entries.map((e) =>
      probeAudioDurationOrNull(e.path).then(
        (d) => ({ e, d }),
        () => ({ e, d: null }),
      ),
    ),
  );
  return results.map(({ e, d }) => ({ ...e, durationSec: d }));
}


/** Locator attempts, in priority order, when resolving a tag to a real
 *  audio file. First hit wins. Each attempt is the absolute directory
 *  the resolver scans; the resolver accepts every supported extension
 *  at each directory. */
export interface BgmResolution {
  /** Tag (e.g. "ambient-take-your-pick" or "calm"). */
  tag: string;
  /** Optional absolute directory containing project-local overrides.
   *  When present, this runs before the curated library so a project
   *  can shadow a track with its own mix. */
  projectDir?: string;
  /** Optional absolute directory of the curated library
   *  (`assets/bgm/`). When omitted the resolver throws instead of
   *  silently returning nothing — there's nothing to find. */
  curatedDir?: string;
}

export interface ResolvedBgm {
  tag: string;
  path: string;
  /** Where the path came from — `project` or `curated`. Tests assert
   *  on this to verify precedence. */
  source: "project" | "curated";
}

/** Tag → real-file-path resolution. Search order:
 *
 *  1. `{projectDir}/<tag>.{wav,mp3,m4a}` — project-local override (this is
 *     where `video audio-asset --bgm <tag>` writes its output).
 *  2. `{curatedDir}/<tag>.{wav,mp3,m4a}` — the canonical
 *     `assets/bgm/` library every project pulls from.
 *  3. Empty file-name substring match in either directory.
 *
 *  The resolver never silently picks a wrong file: when both attempts
 *  miss it throws `AudioAssetError` with the directories it searched,
 *  so the CLI can print a precise "tag X not found" error.
 */
export function resolveBgmTag(resolution: BgmResolution): ResolvedBgm {
  const tag = resolution.tag.trim();
  if (tag.length === 0) {
    throw new AudioAssetError("bgm tag is empty", "library");
  }
  const searched: string[] = [];
  for (const dir of [resolution.projectDir, resolution.curatedDir]) {
    if (!dir) continue;
    if (!existsSync(dir)) {
      searched.push(dir);
      continue;
    }
    const exact = pickExact(dir, tag);
    if (exact) {
      return {
        tag,
        path: exact,
        source: dir === resolution.projectDir ? "project" : "curated",
      };
    }
    const fuzzy = pickFuzzy(dir, tag);
    if (fuzzy) {
      return {
        tag,
        path: fuzzy,
        source: dir === resolution.projectDir ? "project" : "curated",
      };
    }
    searched.push(dir);
  }
  throw new AudioAssetError(
    `bgm tag "${tag}" not found (searched: ${searched.join(", ") || "<none>"})`,
    "library",
  );
}

function pickExact(dir: string, tag: string): string | null {
  for (const ext of [".wav", ".mp3", ".m4a"]) {
    const p = path.join(dir, `${tag}${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

function pickFuzzy(dir: string, tag: string): string | null {
  const tagLc = tag.toLowerCase();
  const entries = readdirSync(dir)
    .filter((f) => {
      const lc = f.toLowerCase();
      if (lc.endsWith(".silent.wav")) return false; // make's placeholder
      if (!(lc.endsWith(".wav") || lc.endsWith(".mp3") || lc.endsWith(".m4a"))) {
        return false;
      }
      return lc.slice(0, lc.lastIndexOf(".")).includes(tagLc);
    })
    .sort();
  if (entries.length === 0) return null;
  return path.join(dir, entries[0] ?? "");
}

/** Best match by mood label (e.g. "ambient", "rock", "cheerful"). When
 *  the mood maps to multiple tags, returns the first alphabetically —
 *  curated choices stay stable across runs. Throws when the curated
 *  library has no tag with that mood. */
export function pickByMood(
  library: LocalBgmEntry[],
  mood: string,
): LocalBgmEntry {
  const matches = library.filter(
    (e) => e.mood.toLowerCase() === mood.toLowerCase(),
  );
  if (matches.length === 0) {
    throw new AudioAssetError(
      `no local BGM tag matches mood "${mood}" (have: ${library
        .map((e) => e.mood)
        .filter((value, i, arr) => arr.indexOf(value) === i)
        .join(", ")})`,
      "library",
    );
  }
  return matches[0]!;
}

/** Distinct mood labels in the library, in alphabetical order. Useful for
 *  surfacing the available options in a CLI `--help` block. */
export function listMoods(library: LocalBgmEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of library) {
    const m = e.mood.toLowerCase();
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out.sort();
}
