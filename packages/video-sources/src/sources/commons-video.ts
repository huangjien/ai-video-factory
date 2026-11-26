import { isFreeLicense, normalizeLicense } from "@video/image-sources";
import { fetchJson, qs, stripHtml } from "@video/image-sources";
import { z } from "zod/v3";
import type {
  VideoCandidate,
  VideoSearchOptions,
  VideoSource,
} from "../types.js";

/**
 * Wikimedia Commons video files — the primary (v1: only) source for
 * freely-licensed archival footage.
 *
 * Same MediaWiki API family as the picture source in @video/image-sources,
 * with `filetype:video` in the search and `mediatype` in the file record:
 * the "no copyright issue" guarantee still comes from the file's own
 * `extmetadata`, filtered by the SAME licence gate (PD / CC0 / PDM).
 *
 * Query shape:
 *   action=query&generator=search&gsrsearch=<terms> filetype:video
 *   gsrnamespace=6 (File)&prop=imageinfo&iiprop=url|size|extmetadata|mediatype
 *
 * No `iiurlwidth` — video files have no scaled transcode in imageinfo;
 * the original bytes come back, so the byte cap at parse time matters
 * more here than it ever did for pictures.
 */

export interface CommonsVideoSourceOptions {
  apiBase?: string | undefined;
}

const DEFAULT_API = "https://commons.wikimedia.org/w/api.php";

/** Wikimedia transcodes video to several sizes; the original can be
 *  enormous. Candidates at or above this are dropped at parse time —
 *  the download cap would reject them anyway, and the search should
 *  not surface what cannot ship. */
export const MAX_CANDIDATE_BYTES = 200 * 1024 * 1024;

/** The MediaWiki response, validated at the boundary. Everything the
 *  parser reads is declared; unknown fields stay unknown, and a page
 *  without usable imageinfo is skipped rather than trusted. */
const extMetadataValue = z.object({ value: z.string().optional() });

const imageInfoSchema = z.object({
  url: z.string().optional(),
  descriptionurl: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  size: z.number().optional(),
  duration: z.number().optional(),
  mediatype: z.string().optional(),
  extmetadata: z.record(extMetadataValue).optional(),
});

const responseSchema = z.object({
  query: z
    .object({
      pages: z
        .array(
          z.object({
            title: z.string().optional(),
            imageinfo: z.array(imageInfoSchema).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

function metaValue(
  meta: Record<string, { value?: string | undefined }>,
  key: string,
): string {
  const entry = meta[key];
  if (entry === undefined || typeof entry.value !== "string") return "";
  return stripHtml(entry.value);
}

/** Parse a Commons `action=query` response into video candidates.
 *  Exported so the mapping is testable without touching the network.
 *  A malformed response parses to an empty list — a source that cannot
 *  speak the shape is out, not fatal. */
export function parseCommonsVideoResponse(
  json: unknown,
  query: string,
): VideoCandidate[] {
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return [];
  const pages = parsed.data.query?.pages ?? [];
  const out: VideoCandidate[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (info === undefined) continue;
    // Belt and braces: the `filetype:video` search should already have
    // excluded stills, but a search index can lag the file record.
    if (info.mediatype !== undefined && info.mediatype !== "VIDEO") continue;
    const meta = info.extmetadata ?? {};
    const license = normalizeLicense(
      metaValue(meta, "License") || metaValue(meta, "LicenseShortName"),
    );
    // Wikimedia's own non-free flag overrides a licence string that reads
    // as free — same rule as the picture source.
    if (metaValue(meta, "Copyrighted").toLowerCase() === "true") continue;
    const fileUrl = info.url;
    if (fileUrl === undefined || fileUrl === "") continue;
    if ((info.size ?? 0) > MAX_CANDIDATE_BYTES) continue;
    const title = (page.title ?? "").replace(/^File:/, "");
    const duration =
      typeof info.duration === "number" && Number.isFinite(info.duration)
        ? info.duration
        : null;
    out.push({
      source: "commons-video",
      title,
      pageUrl:
        info.descriptionurl ??
        `https://commons.wikimedia.org/wiki/${page.title ?? ""}`,
      fileUrl,
      author: metaValue(meta, "Artist"),
      license,
      licenseUrl: metaValue(meta, "LicenseUrl"),
      width: info.width ?? null,
      height: info.height ?? null,
      durationSec: duration,
      sizeBytes: info.size ?? null,
      digestKey: `${fileUrl}|${license}`,
      query,
    });
  }
  return out;
}

export class CommonsVideoSource implements VideoSource {
  readonly name = "commons-video" as const;
  private readonly apiBase: string;

  constructor(opts: CommonsVideoSourceOptions = {}) {
    this.apiBase = opts.apiBase ?? DEFAULT_API;
  }

  async search(
    query: string,
    opts: VideoSearchOptions,
  ): Promise<VideoCandidate[]> {
    const terms = query.trim();
    if (terms === "") return [];
    const url = `${this.apiBase}?${qs({
      action: "query",
      format: "json",
      formatversion: 2,
      generator: "search",
      gsrsearch: `${terms} filetype:video`,
      gsrnamespace: 6,
      gsrlimit: opts.limit,
      prop: "imageinfo",
      iiprop: "url|size|extmetadata|mediatype|duration",
    })}`;
    const json = await fetchJson(url, {
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    return parseCommonsVideoResponse(json, terms);
  }
}

/** Keep only the candidates a video may ship. Every video-source candidate
 *  is external, so unlike the picture filter there is no `owned` lane. */
export function filterFreeVideos(
  candidates: VideoCandidate[],
  allow: readonly string[] = ["PD", "CC0", "PDM"],
): VideoCandidate[] {
  return candidates.filter((c) =>
    isFreeLicense(normalizeLicense(c.license), allow),
  );
}
