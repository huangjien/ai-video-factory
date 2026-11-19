import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { FREE_LICENSES, isFreeLicense } from "./license.js";
import { USER_AGENT } from "./http.js";
import type {
  HistoricalCandidate,
  PictureSource,
  SceneSourcePlan,
  SceneSourceResolution,
  SourceMode,
} from "./types.js";

/**
 * Fan out over the picture sources, filter by license, and pick the one
 * picture that best answers the scene's query.
 *
 * Every failure here is soft: a source that times out is skipped, a source
 * that returns nothing is skipped, a picture whose license is not free is
 * skipped. The scene falls back to plain generation.
 */

/** Bytes cap for a downloaded picture. A museum scan can be 100 MB; the
 *  scene needs a screen-sized picture, not the master file. */
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export interface SearchOptions {
  sources: PictureSource[];
  /** Candidates requested per source. */
  limit?: number | undefined;
  /** License codes accepted. Defaults to PD / CC0 / PDM. */
  allowLicenses?: readonly string[] | undefined;
  signal?: AbortSignal | undefined;
}

/** Ask every source; a source that throws contributes nothing. */
export async function searchAllSources(
  query: string,
  opts: SearchOptions,
): Promise<HistoricalCandidate[]> {
  const results = await Promise.all(
    opts.sources.map(async (source) => {
      try {
        return await source.search(query, {
          limit: opts.limit ?? 8,
          ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
        });
      } catch {
        return [] as HistoricalCandidate[];
      }
    }),
  );
  return dedupe(results.flat());
}

/** Same picture surfaced by two sources — keep the first. */
export function dedupe(candidates: HistoricalCandidate[]): HistoricalCandidate[] {
  const seen = new Set<string>();
  const out: HistoricalCandidate[] = [];
  for (const c of candidates) {
    const key = c.localPath ?? c.fileUrl;
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Keep the candidates a video may ship: free-license external pictures,
 *  plus the project's own pictures (which carry `OWNED`). */
export function filterFree(
  candidates: HistoricalCandidate[],
  allow: readonly string[] = FREE_LICENSES,
): HistoricalCandidate[] {
  return candidates.filter(
    (c) => c.owned || isFreeLicense(c.license, allow),
  );
}

/** Search tokens. Latin words, plus CJK bigrams so a Chinese subject still
 *  matches a Chinese title. */
export function tokenSet(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/[a-z0-9]+/g)) out.add(m[0]);
  const cjk = lower.replace(/[^぀-ヿ㐀-䶿一-鿿]/g, "");
  for (let i = 0; i + 1 < cjk.length; i++) out.add(cjk.slice(i, i + 2));
  return out;
}

/** How well a candidate answers the query. */
export function scoreCandidate(
  candidate: HistoricalCandidate,
  queryTokens: Set<string>,
): number {
  // The candidate's own `query` field is deliberately NOT scored: it is
  // the search that found the picture, not a description of it, and
  // counting it would make every candidate match the query equally.
  const titleTokens = tokenSet(`${candidate.title} ${candidate.author}`);
  let hits = 0;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) hits += 1;
  }
  // A bigger picture wins a tie — a 400px thumbnail is not usable.
  const area =
    candidate.width !== null && candidate.height !== null
      ? candidate.width * candidate.height
      : 0;
  const sizeBonus = area > 0 ? Math.min(4, Math.log10(area) - 4) : 0;
  return hits * 10 + sizeBonus;
}

/** The best candidate for the query, or null when nothing qualifies. */
export function pickBest(
  candidates: HistoricalCandidate[],
  query: string,
): HistoricalCandidate | null {
  if (candidates.length === 0) return null;
  const queryTokens = tokenSet(query);
  let best: HistoricalCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const c of candidates) {
    const score = scoreCandidate(c, queryTokens);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

export interface DownloadedPicture {
  bytes: Uint8Array;
  contentType: string;
  /** sha256 of the bytes — the audit trail's fingerprint. */
  sha256: string;
}

/** Fetch the picture's bytes. Null when the download fails or is too big;
 *  the caller then falls back to plain generation. */
export async function downloadCandidate(
  candidate: HistoricalCandidate,
  opts: { signal?: AbortSignal | undefined } = {},
): Promise<DownloadedPicture | null> {
  if (candidate.localPath !== null) {
    try {
      const buf = await readFile(candidate.localPath);
      return {
        bytes: new Uint8Array(buf),
        contentType: contentTypeForPath(candidate.localPath),
        sha256: sha256(buf),
      };
    } catch {
      return null;
    }
  }
  if (candidate.fileUrl === "") return null;
  try {
    const res = await fetch(candidate.fileUrl, {
      headers: { "User-Agent": USER_AGENT },
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    if (!res.ok) return null;
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > MAX_DOWNLOAD_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_DOWNLOAD_BYTES) return null;
    if (buf.byteLength === 0) return null;
    return {
      bytes: buf,
      contentType: (res.headers.get("content-type") ?? "").split(";")[0] ?? "",
      sha256: sha256(buf),
    };
  } catch {
    return null;
  }
}

function contentTypeForPath(p: string): string {
  const lower = p.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/** sha256 of the bytes, hex. */
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

/**
 * Resolve the mode + picture for one scene.
 *
 * The ladder: `direct` needs a picture that may BE the frame. Without one
 * it falls back to `reference` if any picture was found, and to `none`
 * otherwise. A `reference` plan without a picture is `none` too.
 */
export function resolveSceneSource(
  scene: number,
  plannedMode: SourceMode,
  candidates: HistoricalCandidate[],
  query: string,
): SceneSourceResolution {
  const best = pickBest(candidates, query);
  if (plannedMode === "none") {
    return { scene, mode: "none", candidate: null, digest: "", note: "not a historical scene" };
  }
  if (best === null) {
    return {
      scene,
      mode: "none",
      candidate: null,
      digest: "",
      note: "no freely-licensed picture found",
    };
  }
  if (plannedMode === "direct") {
    // Only a picture that may BE the frame can be the frame. The film's
    // own cast art can only inform one.
    const frame = pickBest(
      candidates.filter((c) => c.directEligible),
      query,
    );
    if (frame !== null) {
      return {
        scene,
        mode: "direct",
        candidate: frame,
        digest: `direct:${sha256Text(frame.digestKey)}`,
        note: `using the picture itself — ${frame.title} (${frame.source}, ${frame.license})`,
      };
    }
    return {
      scene,
      mode: "reference",
      candidate: best,
      digest: `ref:${sha256Text(best.digestKey)}`,
      note: `reference picture — ${best.title} (${best.source}, ${best.license})`,
    };
  }
  return {
    scene,
    mode: "reference",
    candidate: best,
    digest: `ref:${sha256Text(best.digestKey)}`,
    note: `reference picture — ${best.title} (${best.source}, ${best.license})`,
  };
}

/** sha256 of a string, hex. */
export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface RetrieveForScenesOptions {
  sources: PictureSource[];
  /** License codes accepted. Defaults to PD / CC0 / PDM. */
  allowLicenses?: readonly string[] | undefined;
  /** Candidates requested per source. */
  limit?: number | undefined;
  /** Candidates kept per scene for the matcher. Default 5. */
  maxPerScene?: number | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * The searches to try for one scene, widest first.
 *
 * A picture archive ANDs its terms, so a rich query finds nothing while
 * its subject finds plenty. The ladder is: the planned query, the bare
 * subject, then the query's individual terms.
 */
export function queryVariants(plan: SceneSourcePlan): string[] {
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

/**
 * Search the variants until an EXTERNAL source answers.
 *
 * The project's own pictures answer every query (the cast sheet is always
 * there), so they cannot be the signal that a query was too narrow —
 * only a real archive hit can end the ladder.
 */
async function searchWithFallback(
  plan: SceneSourcePlan,
  opts: RetrieveForScenesOptions,
): Promise<HistoricalCandidate[]> {
  const variants = queryVariants(plan);
  let ownOnly: HistoricalCandidate[] = [];
  for (const variant of variants) {
    const found = filterFree(
      await searchAllSources(variant, {
        sources: opts.sources,
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.allowLicenses !== undefined
          ? { allowLicenses: opts.allowLicenses }
          : {}),
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      }),
      opts.allowLicenses ?? FREE_LICENSES,
    );
    if (found.some((c) => !c.owned)) return found;
    if (ownOnly.length === 0) ownOnly = found;
  }
  return ownOnly;
}

/**
 * The pictures found for every historical scene in the plan — the FULL
 * list per scene, not one pick. The pick is a judgement about meaning,
 * and it belongs to the matcher (an LLM), not to the string scoring.
 */
export async function collectCandidates(
  plan: SceneSourcePlan[],
  opts: RetrieveForScenesOptions,
): Promise<Map<number, HistoricalCandidate[]>> {
  const out = new Map<number, HistoricalCandidate[]>();
  const wanted = plan.filter((p) => p.historical && p.mode !== "none");
  const results = await Promise.all(
    wanted.map(async (p) => {
      const candidates = await searchWithFallback(p, opts);
      return [p.scene, candidates.slice(0, opts.maxPerScene ?? 5)] as const;
    }),
  );
  for (const [scene, candidates] of results) out.set(scene, candidates);
  return out;
}

/**
 * Resolve the picture for every historical scene in the plan.
 *
 * Scenes the plan did not mark historical are absent from the result — no
 * network was spent on them, which is the whole point of planning first.
 */
export async function retrieveForScenes(
  plan: SceneSourcePlan[],
  opts: RetrieveForScenesOptions,
): Promise<Map<number, SceneSourceResolution>> {
  const out = new Map<number, SceneSourceResolution>();
  const wanted = plan.filter((p) => p.historical && p.mode !== "none");
  const results = await Promise.all(
    wanted.map(async (p) => {
      const candidates = await searchWithFallback(p, opts);
      return [
        p.scene,
        resolveSceneSource(p.scene, p.mode, candidates, p.query),
      ] as const;
    }),
  );
  for (const [scene, resolution] of results) out.set(scene, resolution);
  return out;
}
