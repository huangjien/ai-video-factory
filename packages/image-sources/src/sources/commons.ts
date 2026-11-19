import { normalizeLicense } from "../license.js";
import { fetchJson, qs, stripHtml } from "../http.js";
import type {
  HistoricalCandidate,
  PictureSearchOptions,
  PictureSource,
} from "../types.js";

/**
 * Wikimedia Commons — the primary source for freely-licensed historical
 * pictures.
 *
 * The MediaWiki search API returns the license as machine-readable
 * `extmetadata` next to every file, which is why this source comes first:
 * the "no copyright issue" guarantee comes from the file record itself,
 * not from an inference about the site.
 *
 * Query shape (v2 output):
 *   action=query&generator=search&gsrsearch=<terms> filetype:bitmap
 *   gsrnamespace=6 (File)&prop=imageinfo&iiprop=url|size|extmetadata
 *
 * `iiurlwidth` asks the API for a scaled thumbnail, so a 6000px scan
 * arrives as a ~1600px JPEG instead of 40 MB.
 */

export interface CommonsPictureSourceOptions {
  apiBase?: string | undefined;
  /** Width of the thumbnail the API should return. */
  thumbWidth?: number | undefined;
}

const DEFAULT_API = "https://commons.wikimedia.org/w/api.php";

interface ExtMetadata {
  [key: string]: { value?: string } | undefined;
}

function metaValue(meta: ExtMetadata, key: string): string {
  const entry = meta[key];
  if (entry === undefined || typeof entry.value !== "string") return "";
  return stripHtml(entry.value);
}

/** Parse a Commons `action=query` response into candidates. Exported so the
 *  mapping is testable without touching the network. */
export function parseCommonsResponse(
  json: unknown,
  query: string,
): HistoricalCandidate[] {
  const pages = (json as { query?: { pages?: unknown } })?.query?.pages;
  if (!Array.isArray(pages)) return [];
  const out: HistoricalCandidate[] = [];
  for (const page of pages) {
    const p = page as {
      title?: string;
      imageinfo?: {
        url?: string;
        descriptionurl?: string;
        thumburl?: string;
        width?: number;
        height?: number;
        extmetadata?: ExtMetadata;
      }[];
    };
    const info = p.imageinfo?.[0];
    if (info === undefined) continue;
    const meta = info.extmetadata ?? {};
    const license = normalizeLicense(
      metaValue(meta, "License") || metaValue(meta, "LicenseShortName"),
    );
    // `Copyrighted: True` is Wikimedia's own flag for a non-free file; it
    // overrides a license string that reads as free.
    const copyrighted = metaValue(meta, "Copyrighted").toLowerCase();
    if (copyrighted === "true") continue;
    const fileUrl = info.thumburl ?? info.url;
    if (fileUrl === undefined || fileUrl === "") continue;
    const title = (p.title ?? "").replace(/^File:/, "");
    out.push({
      source: "commons",
      title,
      pageUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${p.title ?? ""}`,
      fileUrl,
      localPath: null,
      author: metaValue(meta, "Artist"),
      license,
      licenseUrl: metaValue(meta, "LicenseUrl"),
      width: info.width ?? null,
      height: info.height ?? null,
      digestKey: `${fileUrl}|${license}`,
      query,
      owned: false,
      directEligible: true,
    });
  }
  return out;
}

export class CommonsPictureSource implements PictureSource {
  readonly name = "commons" as const;
  readonly offline = false;
  private readonly apiBase: string;
  private readonly thumbWidth: number;

  constructor(opts: CommonsPictureSourceOptions = {}) {
    this.apiBase = opts.apiBase ?? DEFAULT_API;
    this.thumbWidth = opts.thumbWidth ?? 1600;
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
      gsrsearch: `${terms} filetype:bitmap`,
      gsrnamespace: 6,
      gsrlimit: opts.limit,
      prop: "imageinfo",
      iiprop: "url|size|extmetadata",
      iiurlwidth: this.thumbWidth,
    })}`;
    const json = await fetchJson(url, {
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    return parseCommonsResponse(json, terms);
  }
}
