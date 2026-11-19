import { fetchJson, qs } from "../http.js";
import type {
  HistoricalCandidate,
  PictureSearchOptions,
  PictureSource,
} from "../types.js";

/**
 * Open-access museum collections.
 *
 * Three providers with different shapes, one rule: only objects whose own
 * record says "public domain" or "CC0" are returned. A museum record that
 * does not state a license is not a free license.
 *
 *  - The Met: `isPublicDomain` boolean on the object record.
 *  - Smithsonian Open Access: `usage.termsOfUse` on the object record.
 *    Needs a key (DATA_SI_API_KEY); without it the source stays dark.
 *  - Openverse: aggregates CC0/PDM images and states the license per item.
 */

// ─── The Met ────────────────────────────────────────────────────────────────

export interface MetPictureSourceOptions {
  apiBase?: string | undefined;
  maxObjects?: number | undefined;
}

const MET_BASE = "https://collectionapi.metmuseum.org/public/collection/v1";

interface MetObject {
  objectID?: number;
  title?: string;
  artistDisplayName?: string;
  isPublicDomain?: boolean;
  primaryImage?: string;
  primaryImageSmall?: string;
  objectURL?: string;
}

export function parseMetObject(
  obj: MetObject,
  query: string,
): HistoricalCandidate | null {
  if (obj.isPublicDomain !== true) return null;
  const fileUrl = obj.primaryImage ?? obj.primaryImageSmall;
  if (fileUrl === undefined || fileUrl === "") return null;
  return {
    source: "met",
    title: obj.title ?? `The Met object ${obj.objectID ?? ""}`.trim(),
    pageUrl: obj.objectURL ?? `https://www.metmuseum.org/art/collection`,
    fileUrl,
    localPath: null,
    author: obj.artistDisplayName ?? "",
    license: "PD",
    licenseUrl: "https://www.metmuseum.org/about-the-met/policies-and-documents/open-access",
    width: null,
    height: null,
    digestKey: `${fileUrl}|PD`,
    query,
    owned: false,
    directEligible: true,
  };
}

export class MetPictureSource implements PictureSource {
  readonly name = "met" as const;
  readonly offline = false;
  private readonly apiBase: string;
  private readonly maxObjects: number;

  constructor(opts: MetPictureSourceOptions = {}) {
    this.apiBase = opts.apiBase ?? MET_BASE;
    this.maxObjects = opts.maxObjects ?? 4;
  }

  async search(
    query: string,
    opts: PictureSearchOptions,
  ): Promise<HistoricalCandidate[]> {
    const terms = query.trim();
    if (terms === "") return [];
    const searchUrl = `${this.apiBase}/search?${qs({
      q: terms,
      hasImages: "true",
    })}`;
    const searchJson = await fetchJson(searchUrl, {
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    const ids = (searchJson as { objectIDs?: number[] | null }).objectIDs;
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const out: HistoricalCandidate[] = [];
    for (const id of ids.slice(0, this.maxObjects)) {
      const objUrl = `${this.apiBase}/objects/${id}`;
      const objJson = await fetchJson(objUrl, {
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      });
      const candidate = parseMetObject(objJson as MetObject, terms);
      if (candidate !== null) out.push(candidate);
    }
    return out;
  }
}

// ─── Smithsonian Open Access ────────────────────────────────────────────────

export interface SmithsonianPictureSourceOptions {
  apiBase?: string | undefined;
  apiKey?: string | undefined;
  maxObjects?: number | undefined;
}

const SI_BASE = "https://api.si.edu/openaccess/api/v1.0";

interface SiObject {
  title?: string;
  url?: string;
  contentUrl?: string;
  usage?: { access?: string; termsOfUse?: string };
}

/** The Smithsonian states its terms as prose; only CC0 counts as free. */
export function parseSmithsonianObject(
  obj: SiObject,
  query: string,
): HistoricalCandidate | null {
  const terms = (obj.usage?.termsOfUse ?? "").toLowerCase();
  const access = (obj.usage?.access ?? "").toLowerCase();
  if (!terms.includes("cc0") && !access.includes("cc0")) return null;
  const fileUrl = obj.contentUrl;
  if (fileUrl === undefined || fileUrl === "") return null;
  return {
    source: "smithsonian",
    title: obj.title ?? "",
    pageUrl: obj.url ?? "",
    fileUrl,
    localPath: null,
    author: "",
    license: "CC0",
    licenseUrl: "https://www.si.edu/openaccess",
    width: null,
    height: null,
    digestKey: `${fileUrl}|CC0`,
    query,
    owned: false,
    directEligible: true,
  };
}

export class SmithsonianPictureSource implements PictureSource {
  readonly name = "smithsonian" as const;
  readonly offline = false;
  private readonly apiBase: string;
  private readonly apiKey: string | undefined;
  private readonly maxObjects: number;

  constructor(opts: SmithsonianPictureSourceOptions = {}) {
    this.apiBase = opts.apiBase ?? SI_BASE;
    this.apiKey = opts.apiKey ?? process.env["DATA_SI_API_KEY"];
    this.maxObjects = opts.maxObjects ?? 3;
  }

  async search(
    query: string,
    opts: PictureSearchOptions,
  ): Promise<HistoricalCandidate[]> {
    // Without a key the API answers 403 — stay dark instead of failing.
    if (this.apiKey === undefined || this.apiKey === "") return [];
    const terms = query.trim();
    if (terms === "") return [];
    const searchUrl = `${this.apiBase}/search?${qs({
      q: terms,
      api_key: this.apiKey,
      rows: this.maxObjects,
    })}`;
    const json = await fetchJson(searchUrl, {
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    const rows = (
      json as { response?: { rows?: { id?: string; content?: { url?: string } }[] } }
    ).response?.rows;
    if (!Array.isArray(rows)) return [];
    const out: HistoricalCandidate[] = [];
    for (const row of rows) {
      const id = row.content?.url ?? "";
      const m = id.match(/\/([^/]+)$/);
      if (m === null || m[1] === undefined) continue;
      const objUrl = `${this.apiBase}/content/${m[1]}?${qs({
        api_key: this.apiKey,
      })}`;
      const objJson = await fetchJson(objUrl, {
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      });
      const response = (objJson as { response?: { content?: SiObject } })
        .response?.content;
      const candidate = parseSmithsonianObject(response ?? {}, terms);
      if (candidate !== null) out.push(candidate);
    }
    return out;
  }
}

// ─── Openverse ─────────────────────────────────────────────────────────────

export interface OpenversePictureSourceOptions {
  apiBase?: string | undefined;
  maxItems?: number | undefined;
}

const OPENVERSE_BASE = "https://api.openverse.org/v1";

export function parseOpenverseResults(
  json: unknown,
  query: string,
): HistoricalCandidate[] {
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const out: HistoricalCandidate[] = [];
  for (const item of results) {
    const r = item as {
      title?: string;
      url?: string;
      thumbnail?: string;
      foreign_landing_url?: string;
      creator?: string;
      license?: string;
      license_url?: string;
      width?: number;
      height?: number;
    };
    const fileUrl = r.url ?? r.thumbnail;
    if (fileUrl === undefined || fileUrl === "") continue;
    const license = (r.license ?? "").toUpperCase();
    out.push({
      source: "openverse",
      title: r.title ?? "",
      pageUrl: r.foreign_landing_url ?? fileUrl,
      fileUrl,
      localPath: null,
      author: r.creator ?? "",
      license,
      licenseUrl: r.license_url ?? "",
      width: r.width ?? null,
      height: r.height ?? null,
      digestKey: `${fileUrl}|${license}`,
      query,
      owned: false,
      directEligible: true,
    });
  }
  return out;
}

export class OpenversePictureSource implements PictureSource {
  readonly name = "openverse" as const;
  readonly offline = false;
  private readonly apiBase: string;
  private readonly maxItems: number;

  constructor(opts: OpenversePictureSourceOptions = {}) {
    this.apiBase = opts.apiBase ?? OPENVERSE_BASE;
    this.maxItems = opts.maxItems ?? 8;
  }

  async search(
    query: string,
    opts: PictureSearchOptions,
  ): Promise<HistoricalCandidate[]> {
    const terms = query.trim();
    if (terms === "") return [];
    const url = `${this.apiBase}/images/?${qs({
      q: terms,
      license: "cc0,pdm",
      page_size: this.maxItems,
    })}`;
    const json = await fetchJson(url, {
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    return parseOpenverseResults(json, terms);
  }
}
