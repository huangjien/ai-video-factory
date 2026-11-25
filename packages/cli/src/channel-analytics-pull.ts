import { createHash } from "node:crypto";
import {
  refreshAccessToken,
  type FetchImpl,
  type YouTubeCredentials,
} from "@video/youtube";
import { localDate, type VideoRow } from "./channel-analytics-analysis.js";

/**
 * The two platform pulls behind `video analytics`. Thin on purpose: the
 * only decisions made here are what to request and how to read the reply.
 *
 * Every read into a reply goes through a guard (`at`, `text`, `count`) —
 * a field the platform did not send is `undefined`, never NaN and never a
 * cast that compiles because the author hoped. A failure that has a fix
 * the operator can type is reported as that fix (`ChannelAnalyticsError`).
 */

/** A pull failure the command can phrase as a fix. `status` and `reason`
 *  are the API's own words, for callers that branch on them. */
export class ChannelAnalyticsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "ChannelAnalyticsError";
  }
}

export interface PullDeps {
  fetchImpl: FetchImpl;
  /** Between Bilibili requests. The real one waits; tests do not. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface PullResult {
  rows: VideoRow[];
  notes: string[];
}

const YOUTUBE_DATA = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";
/** The videos endpoint takes at most 50 ids; 40 leaves room for ones the
 *  platform has since removed. */
const VIDEOS_PER_CALL = 40;
const ANALYTICS_ROWS_PER_CALL = 200;
/** Retention over the channel's whole history: the window bounds the
 *  query, and a video can only have data since it was published. */
const ANALYTICS_WINDOW_DAYS = 3650;

/** The channel as Bilibili knows it. */
const BILIBILI_MID = "1710879058";
/** 50 per page; two pages is the hundred most recent videos. */
const BILIBILI_PAGES = 2;
/** One request per video; a pause keeps the account clear of the limiter. */
const BILIBILI_REQUEST_GAP_MS = 120;
const BILIBILI_UA = "Mozilla/5.0 (Macintosh) Chrome/120.0.0.0";
const BILIBILI_ORIGIN = "https://www.bilibili.com/";

const TOKEN_FIX =
  "the YouTube token cannot do this — run `video youtube --auth --scope manage`, store the printed token, and retry";

// ---------------------------------------------------------------- guards

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** A number the platform sent as a number or as a decimal string. An
 *  empty string is a missing field, not zero — YouTube omits counters it
 *  has nothing to count. */
export function count(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Walks nested JSON by key; a numeric key indexes into an array.
 *  `undefined` as soon as one step is missing or is not a container. */
export function at(value: unknown, ...keys: string[]): unknown {
  let node: unknown = value;
  for (const key of keys) {
    if (Array.isArray(node)) {
      node = node[Number(key)];
      continue;
    }
    const container = record(node);
    if (container === undefined) return undefined;
    node = container[key];
  }
  return node;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  fetchImpl: FetchImpl,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    throw new ChannelAnalyticsError(
      `request to ${new URL(url).host} failed: ${(err as Error).message}`,
    );
  }
  if (res.ok) return res.json();
  const body = record(await res.json().catch(() => undefined));
  const message = text(at(body, "error", "message"));
  const reason = text(at(body, "error", "errors", "0", "reason"));
  throw new ChannelAnalyticsError(
    `${new URL(url).host} answered ${res.status}${message === undefined ? "" : `: ${message}`}`,
    res.status,
    reason,
  );
}

// ---------------------------------------------------------------- YouTube

/** `PT1H2M3S` → 3723. Anything else reads as zero, which lands in the
 *  shortest bucket rather than inventing a length. */
export function parseIsoDuration(value: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (match === null) return 0;
  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0)
  );
}

export async function pullYouTube(
  creds: YouTubeCredentials,
  deps: PullDeps,
): Promise<PullResult> {
  let token: string;
  try {
    token = await refreshAccessToken(creds, deps.fetchImpl);
  } catch (err) {
    throw new ChannelAnalyticsError(
      `${TOKEN_FIX} (token refresh failed: ${(err as Error).message})`,
    );
  }
  const get = async (url: string): Promise<unknown> => {
    try {
      return await fetchJson(
        url,
        { headers: { Authorization: `Bearer ${token}` } },
        deps.fetchImpl,
      );
    } catch (err) {
      if (
        err instanceof ChannelAnalyticsError &&
        err.reason === "insufficientPermissions"
      ) {
        throw new ChannelAnalyticsError(TOKEN_FIX, err.status, err.reason);
      }
      throw err;
    }
  };
  const query = (base: string, params: Record<string, string>): string =>
    `${base}?${new URLSearchParams(params)}`;

  // Which channel — read from the token's own account, never hard-coded.
  const channel = await get(
    query(`${YOUTUBE_DATA}/channels`, {
      part: "contentDetails",
      mine: "true",
    }),
  );
  const uploads = text(
    at(channel, "items", "0", "contentDetails", "relatedPlaylists", "uploads"),
  );
  if (uploads === undefined) {
    throw new ChannelAnalyticsError(
      "the YouTube account behind the token has no uploads playlist",
    );
  }
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (;;) {
    const page = await get(
      query(`${YOUTUBE_DATA}/playlistItems`, {
        part: "contentDetails",
        maxResults: "50",
        playlistId: uploads,
        ...(pageToken === undefined ? {} : { pageToken }),
      }),
    );
    for (const item of list(at(page, "items"))) {
      const id = text(at(item, "contentDetails", "videoId"));
      if (id !== undefined) ids.push(id);
    }
    pageToken = text(at(page, "nextPageToken"));
    if (pageToken === undefined) break;
  }

  const rows: VideoRow[] = [];
  for (let i = 0; i < ids.length; i += VIDEOS_PER_CALL) {
    const batch = await get(
      query(`${YOUTUBE_DATA}/videos`, {
        part: "statistics,contentDetails,snippet,status",
        id: ids.slice(i, i + VIDEOS_PER_CALL).join(","),
      }),
    );
    for (const item of list(at(batch, "items"))) {
      const video = record(item);
      // The auto-producer uploads LOCKED PRIVATE; a video nobody can watch
      // has no audience to measure yet.
      if (
        video === undefined ||
        at(video, "status", "privacyStatus") !== "public"
      ) {
        continue;
      }
      rows.push({
        platform: "youtube",
        id: text(video["id"]) ?? "",
        title: text(at(video, "snippet", "title")) ?? "",
        durationSec: parseIsoDuration(
          text(at(video, "contentDetails", "duration")) ?? "",
        ),
        publishedAt: (text(at(video, "snippet", "publishedAt")) ?? "").slice(
          0,
          10,
        ),
        views: count(at(video, "statistics", "viewCount")) ?? 0,
        likes: count(at(video, "statistics", "likeCount")) ?? 0,
        comments: count(at(video, "statistics", "commentCount")) ?? 0,
      });
    }
  }

  const notes: string[] = [];
  const retention = await pullRetention(token, deps);
  if (typeof retention === "string") {
    notes.push(`完播率/订阅转化不可用：${retention}`);
  } else {
    for (const row of rows) {
      const found = retention.get(row.id);
      if (found === undefined) continue;
      row.retentionPct = found.retentionPct;
      row.subscribersGained = found.subscribersGained;
    }
  }
  return { rows, notes };
}

/**
 * Average view percentage and subscribers gained, per video, from the
 * YouTube Analytics API. That API is enabled per Google Cloud project and
 * off by default, so a failure here is a NOTE on the report, never a
 * failed pull — everything else stands without retention.
 */
async function pullRetention(
  token: string,
  deps: PullDeps,
): Promise<
  Map<string, { retentionPct: number; subscribersGained: number }> | string
> {
  const now = deps.now?.() ?? Date.now();
  // The API cannot report today.
  const end = new Date(now - 24 * 60 * 60 * 1000);
  const start = new Date(
    end.getTime() - ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const out = new Map<
    string,
    { retentionPct: number; subscribersGained: number }
  >();
  try {
    for (let startIndex = 1; ; startIndex += ANALYTICS_ROWS_PER_CALL) {
      const url = `${YOUTUBE_ANALYTICS}?${new URLSearchParams({
        ids: "channel==MINE",
        startDate: localDate(start.toISOString()),
        endDate: localDate(end.toISOString()),
        metrics: "averageViewPercentage,subscribersGained",
        dimensions: "video",
        maxResults: String(ANALYTICS_ROWS_PER_CALL),
        startIndex: String(startIndex),
      })}`;
      const report = record(
        await fetchJson(
          url,
          { headers: { Authorization: `Bearer ${token}` } },
          deps.fetchImpl,
        ),
      );
      const headers = list(at(report, "columnHeaders")).map((header) =>
        text(at(header, "name")),
      );
      const column = (name: string): number => headers.indexOf(name);
      const idAt = column("video");
      const retentionAt = column("averageViewPercentage");
      const subsAt = column("subscribersGained");
      const rows = list(at(report, "rows"));
      if (idAt < 0 || retentionAt < 0) {
        return "YouTube Analytics API 的回复缺少 video/averageViewPercentage 列";
      }
      for (const row of rows) {
        const cells = list(row);
        const id = text(cells[idAt]);
        const retentionPct = count(cells[retentionAt]);
        if (id === undefined || retentionPct === undefined) continue;
        out.set(id, {
          retentionPct,
          subscribersGained: subsAt < 0 ? 0 : (count(cells[subsAt]) ?? 0),
        });
      }
      if (rows.length < ANALYTICS_ROWS_PER_CALL) break;
    }
    return out;
  } catch (err) {
    const message =
      err instanceof ChannelAnalyticsError
        ? err.message
        : `unexpected reply: ${(err as Error).message}`;
    // The one failure every fresh project hits, said once and briefly.
    if (/has not been used in project/i.test(message)) {
      const link = /https:\/\/\S+/.exec(message)?.[0] ?? "";
      return `YouTube Analytics API 未在此项目启用，启用后自动出现${link ? `：${link}` : ""}`;
    }
    return message.length > 220 ? `${message.slice(0, 220)}…` : message;
  }
}

// ---------------------------------------------------------------- Bilibili

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
];

/** Bilibili's request signing: the sorted query plus a key derived from
 *  the session's `img`/`sub` keys, hashed. Byte order, not locale order —
 *  the server compares strings. */
export function wbiSign(
  params: Record<string, string>,
  imgKey: string,
  subKey: string,
  nowSeconds: number,
): string {
  const raw = imgKey + subKey;
  const mixinKey = MIXIN_KEY_ENC_TAB.map((i) => raw[i] ?? "").join("");
  const byBytes = (
    a: readonly [string, string],
    b: readonly [string, string],
  ): number => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const query = Object.entries({ ...params, wts: String(nowSeconds) })
    .sort(byBytes)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
  const wRid = createHash("md5")
    .update(query + mixinKey)
    .digest("hex");
  return `${query}&w_rid=${wRid}`;
}

/** `"06:56"` → 416. A length the listing did not spell out reads as zero. */
export function parseBilibiliLength(value: unknown): number {
  if (typeof value === "number") return value;
  const parts = typeof value === "string" ? value.split(":").map(Number) : [];
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) {
    return 0;
  }
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

export async function pullBilibili(
  cookies: string,
  deps: PullDeps,
): Promise<PullResult> {
  const get = async (url: string): Promise<Record<string, unknown>> => {
    let json: unknown;
    try {
      json = await fetchJson(
        url,
        {
          headers: {
            "User-Agent": BILIBILI_UA,
            Cookie: cookies,
            Referer: BILIBILI_ORIGIN,
          },
        },
        deps.fetchImpl,
      );
    } catch (err) {
      if (err instanceof ChannelAnalyticsError && err.status === 412) {
        throw new ChannelAnalyticsError(
          "bilibili rejected the request as automated (HTTP 412) — wait a minute and run `video analytics` again",
          err.status,
        );
      }
      throw err;
    }
    const envelope = record(json);
    const code = envelope?.["code"];
    if (code !== 0) {
      const message = text(envelope?.["message"]);
      throw new ChannelAnalyticsError(
        `bilibili answered code ${String(code)}${message === undefined ? "" : `: ${message}`}${code === -101 ? " — the login cookies expired" : ""}`,
      );
    }
    return envelope!;
  };

  const nav = await get("https://api.bilibili.com/x/web-interface/nav");
  // The file name of each key image, without its extension.
  const keyName = (url: unknown): string =>
    (text(url) ?? "").split("/").pop()?.split(".")[0] ?? "";
  const imgKey = keyName(at(nav, "data", "wbi_img", "img_url"));
  const subKey = keyName(at(nav, "data", "wbi_img", "sub_url"));
  if (imgKey === "" || subKey === "") {
    throw new ChannelAnalyticsError(
      "bilibili gave no signing keys — the login cookies may have expired",
    );
  }

  const listing: {
    bvid: string;
    title: string;
    length: unknown;
    created: number;
  }[] = [];
  for (let pageNumber = 1; pageNumber <= BILIBILI_PAGES; pageNumber++) {
    const signed = wbiSign(
      {
        mid: BILIBILI_MID,
        pn: String(pageNumber),
        ps: "50",
        tid: "0",
        keyword: "",
        order: "pubdate",
        platform: "web",
        web_location: "1550101",
      },
      imgKey,
      subKey,
      Math.floor((deps.now?.() ?? Date.now()) / 1000),
    );
    const page = await get(
      `https://api.bilibili.com/x/space/wbi/arc/search?${signed}`,
    );
    const videos = list(at(page, "data", "list", "vlist"));
    if (videos.length === 0) break;
    for (const video of videos) {
      const bvid = text(at(video, "bvid"));
      const created = count(at(video, "created"));
      if (bvid === undefined || created === undefined) continue;
      listing.push({
        bvid,
        title: text(at(video, "title")) ?? "",
        length: at(video, "length"),
        created,
      });
    }
  }
  if (listing.length === 0) {
    throw new ChannelAnalyticsError(
      "bilibili listed no videos for the channel — the login cookies may have expired",
    );
  }

  const sleep =
    deps.sleep ??
    ((ms: number): Promise<void> =>
      // The package's TS lib is ES2022: no Promise.withResolvers.
      new Promise((resolve) => setTimeout(resolve, ms)));
  const rows: VideoRow[] = [];
  let unreadable = 0;
  for (const [index, entry] of listing.entries()) {
    if (index > 0) await sleep(BILIBILI_REQUEST_GAP_MS);
    let stat: Record<string, unknown> | undefined;
    try {
      stat = record(
        at(
          await get(
            `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(entry.bvid)}`,
          ),
          "data",
          "stat",
        ),
      );
    } catch (err) {
      if (!(err instanceof ChannelAnalyticsError)) throw err;
    }
    if (stat === undefined) {
      unreadable += 1;
      continue;
    }
    rows.push({
      platform: "bilibili",
      id: entry.bvid,
      title: entry.title,
      durationSec: parseBilibiliLength(entry.length),
      publishedAt: localDate(new Date(entry.created * 1000).toISOString()),
      views: count(stat["view"]) ?? 0,
      likes: count(stat["like"]) ?? 0,
      comments: count(stat["reply"]) ?? 0,
      coins: count(stat["coin"]) ?? 0,
      favorites: count(stat["favorite"]) ?? 0,
      shares: count(stat["share"]) ?? 0,
      danmaku: count(stat["danmaku"]) ?? 0,
    });
  }
  // A listing whose every video failed to read is an expired login, not a
  // channel with no engagement.
  if (rows.length === 0) {
    throw new ChannelAnalyticsError(
      "bilibili listed the channel but answered an error for every video — the login cookies may have expired",
    );
  }
  return {
    rows,
    notes:
      unreadable === 0
        ? []
        : [`${unreadable} 个 B 站视频读取统计失败（已删除或审核中），已跳过`],
  };
}
