import { sha256Text } from "@video/image-sources";
import { filterFreeVideos } from "./sources/commons-video.js";
import type {
  SceneVideoPick,
  SceneVideoPlan,
  VideoCandidate,
  VideoSource,
} from "./types.js";

/**
 * Fan out over the clip sources, filter by licence, and resolve the one
 * clip that best covers the scene.
 *
 * Every failure here is soft: a source that times out is skipped, a clip
 * whose licence is not free is skipped, a clip too short for the scene is
 * skipped. The scene falls back to its generated image.
 */

export interface VideoSearchOptionsInternal {
  sources: VideoSource[];
  /** Candidates requested per source. */
  limit?: number | undefined;
  /** Licence codes accepted. Defaults to PD / CC0 / PDM. */
  allowLicenses?: readonly string[] | undefined;
  signal?: AbortSignal | undefined;
}

/** Ask every source; a source that throws contributes nothing. */
export async function searchAllVideoSources(
  query: string,
  opts: VideoSearchOptionsInternal,
): Promise<VideoCandidate[]> {
  const results = await Promise.all(
    opts.sources.map(async (source) => {
      try {
        return await source.search(query, {
          limit: opts.limit ?? 8,
          ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
        });
      } catch {
        return [] as VideoCandidate[];
      }
    }),
  );
  return dedupeVideos(results.flat());
}

/** The same clip surfaced twice — keep the first. */
export function dedupeVideos(
  candidates: VideoCandidate[],
): VideoCandidate[] {
  const seen = new Set<string>();
  const out: VideoCandidate[] = [];
  for (const c of candidates) {
    const key = c.fileUrl;
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Search tokens: Latin words, plus CJK bigrams so a Chinese subject still
 *  matches a Chinese title. Same shape as the picture scorer. */
export function videoTokenSet(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/[a-z0-9]+/g)) out.add(m[0]);
  const cjk = lower.replace(/[^぀-ヿ㐀-䶿一-鿿]/g, "");
  for (let i = 0; i + 1 < cjk.length; i++) out.add(cjk.slice(i, i + 2));
  return out;
}

/** How well a clip answers the query. Duration is NOT scored here — it is
 *  a hard filter at resolve time (a clip shorter than the scene cannot
 *  cover it, no matter how good the title match). */
export function scoreVideoCandidate(
  candidate: VideoCandidate,
  queryTokens: Set<string>,
): number {
  const titleTokens = videoTokenSet(`${candidate.title} ${candidate.author}`);
  let hits = 0;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) hits += 1;
  }
  // A longer clip wins a tie — more trim choices for the scene.
  const lengthBonus =
    candidate.durationSec !== null
      ? Math.min(3, Math.log10(Math.max(1, candidate.durationSec)) * 2)
      : 0;
  return hits * 10 + lengthBonus;
}

/** The best candidate for the query, or null when nothing qualifies. */
export function pickBestVideo(
  candidates: VideoCandidate[],
  query: string,
): VideoCandidate | null {
  if (candidates.length === 0) return null;
  const queryTokens = videoTokenSet(query);
  let best: VideoCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const c of candidates) {
    const score = scoreVideoCandidate(c, queryTokens);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Resolve the clip for one scene.
 *
 * Hard filter first: the clip must be free-licensed, at least as long as
 * the scene (minus a small tolerance — the preprocess trim needs less
 * than the scene runs, not more), and of known length. A clip of unknown
 * duration cannot be trusted to cover the scene and is rejected.
 */
export function resolveSceneVideo(
  candidates: VideoCandidate[],
  query: string,
  minDurationSec: number,
): SceneVideoPick {
  const usable = filterFreeVideos(candidates).filter((c) => {
    if (c.durationSec === null) return false;
    return c.durationSec >= minDurationSec - 0.25;
  });
  if (usable.length === 0) {
    const why =
      candidates.length === 0
        ? "no clip found"
        : candidates.every((c) => c.durationSec === null)
          ? "clips of unknown length"
          : "clips too short for the scene";
    return { candidate: null, note: why };
  }
  const best = pickBestVideo(usable, query);
  if (best === null) return { candidate: null, note: "no clip matches the query" };
  return {
    candidate: best,
    note: `clip — ${best.title} (${best.source}, ${best.license}, ${Math.round(best.durationSec ?? 0)} s)`,
  };
}

/** The searches to try for one scene, widest first — same ladder as the
 *  pictures: planned query, bare subject, then individual terms. */
export function videoQueryVariants(plan: SceneVideoPlan): string[] {
  const out: string[] = [];
  const push = (value: string): void => {
    const v = value.trim();
    if (v !== "" && !out.includes(v)) out.push(v);
  };
  push(plan.query);
  push(plan.subject);
  for (const term of plan.query.split(/[\s,、，]+/)) push(term);
  return out.slice(0, 5);
}

export interface CollectVideoOptions {
  sources: VideoSource[];
  limit?: number | undefined;
  /** Licence codes accepted. Defaults to PD / CC0 / PDM. */
  allowLicenses?: readonly string[] | undefined;
  /** Candidates kept per scene for the matcher. Default 5. */
  maxPerScene?: number | undefined;
  signal?: AbortSignal | undefined;
}

/** The clips found for every footage-suitable scene in the plan — the
 *  FULL list per scene. The pick belongs to the matcher, not to string
 *  scoring. Scenes the plan did not mark are absent from the result. */
export async function collectVideoCandidates(
  plan: SceneVideoPlan[],
  opts: CollectVideoOptions,
): Promise<Map<number, VideoCandidate[]>> {
  const out = new Map<number, VideoCandidate[]>();
  const wanted = plan.filter((p) => p.historical);
  const results = await Promise.all(
    wanted.map(async (p) => {
      const found: VideoCandidate[] = [];
      for (const variant of videoQueryVariants(p)) {
        const hits = filterFreeVideos(
          await searchAllVideoSources(variant, {
            sources: opts.sources,
            ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
            ...(opts.allowLicenses !== undefined
              ? { allowLicenses: opts.allowLicenses }
              : {}),
            ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
          }),
          opts.allowLicenses ?? ["PD", "CC0", "PDM"],
        );
        found.push(...hits);
        if (found.length > 0) break;
      }
      const seen = new Set<string>();
      const deduped = found.filter((c) => {
        if (seen.has(c.fileUrl)) return false;
        seen.add(c.fileUrl);
        return true;
      });
      return [p.scene, deduped.slice(0, opts.maxPerScene ?? 5)] as const;
    }),
  );
  for (const [scene, candidates] of results) out.set(scene, candidates);
  return out;
}

/** The cache-key term for a chosen clip. */
export function videoDigest(candidate: VideoCandidate): string {
  return `clip:${sha256Text(candidate.digestKey)}`;
}
