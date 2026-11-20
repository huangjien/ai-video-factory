import { normalizeLicense } from "../license.js";
import { fetchJson, qs, stripHtml } from "../http.js";
import { rasterUrl } from "./raster.js";
import type {
  HistoricalCandidate,
  PictureSearchOptions,
  PictureSource,
} from "../types.js";

/**
 * Wikipedia article images — the lead picture of the article about the
 * subject ("portrait of Li Shimin").
 *
 * Wikipedia's own lead images are often non-free fair-use uploads hosted on
 * the local wiki, so a lead image is NOT usable on its own. This source
 * therefore does the extra step every time: it resolves the file on
 * Wikimedia Commons and reads the license from the Commons record. A lead
 * image that is not on Commons, or whose Commons record is not free, is
 * dropped.
 *
 * Two requests per lookup (article search, then the Commons license
 * lookup) — acceptable because the license is the whole point.
 */

export interface WikipediaPictureSourceOptions {
  lang?: string | undefined;
  apiBase?: string | undefined;
  commonsApiBase?: string | undefined;
  /** How many article leads to try before giving up on a query. */
  maxLookups?: number | undefined;
}

const DEFAULT_LANG = "en";

function metaValue(
  meta: Record<string, { value?: string } | undefined>,
  key: string,
): string {
  const entry = meta[key];
  if (entry === undefined || typeof entry.value !== "string") return "";
  return stripHtml(entry.value);
}

/** The Commons file title for a Wikipedia image URL, or null when the file
 *  is not hosted on Commons (a fair-use upload is not). */
export function commonsFileTitle(imageUrl: string): string | null {
  const m = imageUrl.match(
    /^https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/[^/]+\/[^/]+\/([^/?#]+)$/,
  );
  if (m === null || m[1] === undefined) return null;
  let name: string;
  try {
    name = decodeURIComponent(m[1]);
  } catch {
    name = m[1];
  }
  return `File:${name}`;
}

/** Parse the Commons `titles=` response for one file. */
export function parseCommonsTitleResponse(
  json: unknown,
  fileTitle: string,
): HistoricalCandidate | null {
  const pages = (json as { query?: { pages?: unknown } })?.query?.pages;
  if (!Array.isArray(pages) || pages.length === 0) return null;
  const page = pages[0] as {
    title?: string;
    imageinfo?: {
      url?: string;
      descriptionurl?: string;
      thumburl?: string;
      width?: number;
      height?: number;
      extmetadata?: Record<string, { value?: string } | undefined>;
    }[];
  };
  const info = page.imageinfo?.[0];
  if (info === undefined) return null;
  const meta = info.extmetadata ?? {};
  const license = normalizeLicense(
    metaValue(meta, "License") || metaValue(meta, "LicenseShortName"),
  );
  const copyrighted = metaValue(meta, "Copyrighted").toLowerCase();
  if (copyrighted === "true") return null;
  // A lead image can be an SVG (a diagram, a seal). The thumbnail the
  // API returns is the raster version of it.
  const fileUrl = rasterUrl(info.url, info.thumburl);
  if (fileUrl === null) return null;
  return {
    source: "wikipedia",
    title: (page.title ?? fileTitle).replace(/^File:/, ""),
    pageUrl:
      info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${fileTitle}`,
    fileUrl,
    localPath: null,
    author: metaValue(meta, "Artist"),
    license,
    licenseUrl: metaValue(meta, "LicenseUrl"),
    width: info.width ?? null,
    height: info.height ?? null,
    digestKey: `${fileUrl}|${license}`,
    query: "",
    owned: false,
    directEligible: true,
  };
}

export class WikipediaPictureSource implements PictureSource {
  readonly name = "wikipedia" as const;
  readonly offline = false;
  private readonly lang: string;
  private readonly apiBase: string;
  private readonly commonsApiBase: string;
  private readonly maxLookups: number;

  constructor(opts: WikipediaPictureSourceOptions = {}) {
    this.lang = opts.lang ?? DEFAULT_LANG;
    this.apiBase =
      opts.apiBase ?? `https://${this.lang}.wikipedia.org/w/api.php`;
    this.commonsApiBase =
      opts.commonsApiBase ?? "https://commons.wikimedia.org/w/api.php";
    this.maxLookups = opts.maxLookups ?? 3;
  }

  async search(
    query: string,
    opts: PictureSearchOptions,
  ): Promise<HistoricalCandidate[]> {
    const terms = query.trim();
    if (terms === "") return [];
    const url = `${this.apiBase}?${qs({
      action: "query",
      format: "json",
      formatversion: 2,
      generator: "search",
      gsrsearch: terms,
      gsrnamespace: 0,
      gsrlimit: this.maxLookups,
      prop: "pageimages|info",
      piprop: "original",
      inprop: "url",
    })}`;
    const json = await fetchJson(url, {
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    const pages = (json as { query?: { pages?: unknown } })?.query?.pages;
    if (!Array.isArray(pages)) return [];
    const out: HistoricalCandidate[] = [];
    for (const page of pages) {
      const p = page as {
        title?: string;
        fullurl?: string;
        original?: { source?: string; width?: number; height?: number };
      };
      const source = p.original?.source;
      if (source === undefined || source === "") continue;
      const fileTitle = commonsFileTitle(source);
      if (fileTitle === null) continue;
      const licenseUrl = `${this.commonsApiBase}?${qs({
        action: "query",
        format: "json",
        formatversion: 2,
        titles: fileTitle,
        prop: "imageinfo",
        iiprop: "url|size|extmetadata",
      })}`;
      const commonsJson = await fetchJson(licenseUrl, {
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      });
      const candidate = parseCommonsTitleResponse(commonsJson, fileTitle);
      if (candidate === null) continue;
      // The article is where a human checks the picture in context; the
      // Commons file is where the license lives. Both are recorded.
      candidate.pageUrl = p.fullurl ?? candidate.pageUrl;
      candidate.query = terms;
      out.push(candidate);
    }
    return out;
  }
}
