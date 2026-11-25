import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FetchImpl } from "@video/youtube";
import {
  ageDays,
  analyze,
  bucketOf,
  coreEngagement,
  coreRate,
  isShortTitle,
  langOf,
  laneOf,
  localDate,
  median,
  pooledRate,
  renderDigest,
  renderReport,
  totalEngagement,
  viewsPerDay,
  type AnalyticsSnapshot,
  type VideoRow,
} from "./channel-analytics-analysis.js";
import {
  ChannelAnalyticsError,
  at,
  count,
  parseBilibiliLength,
  parseIsoDuration,
  pullBilibili,
  pullYouTube,
  wbiSign,
} from "./channel-analytics-pull.js";
import { previousSnapshot, runChannelAnalytics } from "./channel-analytics.js";

/**
 * `video analytics` — the evidence the backlog judge ranks by.
 *
 * The lane rules are pinned with REAL titles, the ones the first draft got
 * wrong: a keyword that names a subject often also names an ordinary one
 * (`cache`, `story`, `writ`, `兵`), and each of these is a regression test
 * for one of those collisions. The numbers in the analysis tests are small
 * enough to check by hand, which is the point — a rate the reader cannot
 * recompute is a rate the reader cannot trust.
 */

const TODAY = "2026-11-25";
/** Fifteen days before TODAY. */
const AGED = "2026-11-10";
/** One day before TODAY — too young for a rate. */
const YOUNG = "2026-11-24";

describe("laneOf — the subject a title belongs to", () => {
  it.each([
    [
      "身体化作世界：盘古、原人与伊米尔，为何孕育三种截然不同的文明秩序？",
      "神话比较",
    ],
    ["AI 时代的软件定价：从按席位收费到为验证过的工作付费", "经济与就业"],
    [
      "Deposit Rates Below 1%: Why the Long Game Just Got More Valuable",
      "经济与就业",
    ],
    ["影子模式：AI答对一千次，为什么还不能获得退款权限？", "AI可靠性与决策"],
    [
      "Reliable AI Agents: Why Carlo's Pizza Needs Evidence, Not Nationality",
      "AI可靠性与决策",
    ],
    [
      "Why the First Token Takes So Long: LLM Inference, Prefill & KV Cache Explained",
      "AI与软件工程",
    ],
    ["别微操 Agent：任务式指挥式系统设计", "AI与软件工程"],
    [
      "The History of AI: From Turing's Question to ChatGPT (1950–2022)",
      "AI与软件工程",
    ],
    [
      "From App Entry Points to Callable Capabilities: How AI Rewrites Software Interaction",
      "AI与软件工程",
    ],
    ["领域建模入门：软件真正的骨相，是业务逻辑而非技术堆叠", "AI与软件工程"],
    [
      "Manage Your Team Like a Distributed System: Scheduling, Failures, Fixes",
      "组织与管理",
    ],
    ["Why Armies Keep a Professional “Enemy” Force", "军制与战争史"],
    [
      "20 Tons Stopped in 3 Seconds: The Most Dangerous Routine in Aviation",
      "军制与战争史",
    ],
    ["世界杯冠军之路", "其他"],
    ["没有金属的星球：为什么一柄铁剑会被当作神兵？", "艺术考古与文明"],
    [
      "第二名的诅咒：为什么离成功最近的人反而最累？| 社会比较理论",
      "心理与沟通",
    ],
    ["写故事的底层逻辑 | 7个方法告别空白页", "叙事思维与数学"],
    [
      "The 7 Basic Plots: Every Story You Love Runs on One of Seven Engines",
      "叙事思维与数学",
    ],
    ["Don t Raise a Red Flag", "其他"],
  ] as const)("%s → %s", (title, lane) => {
    expect(laneOf(title)).toBe(lane);
  });
});

describe("title facts", () => {
  it("reads the language, the Shorts tag and the length bucket", () => {
    expect(langOf("为什么军官要定期轮岗")).toBe("zh");
    expect(
      langOf("中印欧神话对比 1：创世与秩序类型学 Chinese-Indian-European"),
    ).toBe("zh");
    expect(langOf("Why Officers Rotate Posts")).toBe("en");
    expect(isShortTitle("朝鲜战争从未正式结束 #Shorts")).toBe(true);
    expect(isShortTitle("Why AI Maps Get Place Names Wrong #Short")).toBe(true);
    expect(isShortTitle("Why Officers Rotate Posts")).toBe(false);
    expect(bucketOf(0)).toBe("<2min");
    expect(bucketOf(119)).toBe("<2min");
    expect(bucketOf(120)).toBe("2-4min");
    expect(bucketOf(171)).toBe("2-4min");
    expect(bucketOf(3600)).toBe("20min+");
    expect(bucketOf(Number.NaN)).toBe("20min+");
  });
});

// ---------------------------------------------------------------- fixtures

type RowSpec = Pick<VideoRow, "platform" | "title" | "publishedAt" | "views"> &
  Partial<Omit<VideoRow, "platform" | "title" | "publishedAt" | "views">>;

/** Only the optional numbers the test gave — the row type forbids an
 *  explicit `undefined`. */
const given = (
  values: Record<string, number | undefined>,
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(values).filter(
      (pair): pair is [string, number] => pair[1] !== undefined,
    ),
  );

describe("metrics", () => {
  let next = 0;
  const video = (spec: RowSpec): VideoRow => ({
    id: `row-${next++}`,
    platform: spec.platform,
    title: spec.title,
    publishedAt: spec.publishedAt,
    views: spec.views,
    durationSec: spec.durationSec ?? 300,
    likes: spec.likes ?? 0,
    comments: spec.comments ?? 0,
    ...given({
      coins: spec.coins,
      favorites: spec.favorites,
      shares: spec.shares,
      danmaku: spec.danmaku,
      retentionPct: spec.retentionPct,
      subscribersGained: spec.subscribersGained,
    }),
  });
  const base = { platform: "youtube" as const, title: "t", publishedAt: AGED };

  it("takes the middle value, the mean of two middles, or nothing", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("pools a rate over sums, so one popular video is not averaged as ten unseen ones", () => {
    const rows = [
      video({ ...base, views: 1000, likes: 10 }),
      video({ ...base, views: 1, likes: 1 }),
    ];
    expect(pooledRate(rows)).toBeCloseTo(11 / 1001);
    expect(pooledRate([video({ ...base, views: 0 })])).toBeNull();
  });

  it("engagement counts what the platform offers and nothing it does not", () => {
    expect(
      coreEngagement(video({ ...base, views: 100, likes: 3, comments: 2 })),
    ).toBe(5);
    expect(
      totalEngagement(video({ ...base, views: 100, likes: 3, comments: 2 })),
    ).toBe(5);
    expect(
      totalEngagement(
        video({
          ...base,
          views: 100,
          likes: 3,
          comments: 2,
          coins: 1,
          favorites: 4,
          shares: 5,
          danmaku: 6,
        }),
      ),
    ).toBe(21);
    expect(
      coreRate(video({ ...base, views: 100, likes: 3, comments: 2 })),
    ).toBe(0.05);
  });

  it("a video published today has one day behind it, and a future date none", () => {
    expect(ageDays(AGED, TODAY)).toBe(15);
    expect(ageDays(TODAY, TODAY)).toBe(0);
    expect(ageDays("2026-12-01", TODAY)).toBe(0);
    expect(ageDays("not a date", TODAY)).toBe(0);
    expect(
      viewsPerDay(video({ ...base, views: 90, publishedAt: TODAY }), TODAY),
    ).toBe(90);
    expect(viewsPerDay(video({ ...base, views: 90 }), TODAY)).toBe(6);
  });

  it("reads a calendar day in the machine's own zone", () => {
    expect(localDate("2026-11-25T23:30:00.000Z")).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    expect(localDate("garbage")).toBe("garbage");
  });
});

// ---------------------------------------------------------------- analysis

describe("analyze — what the numbers are allowed to say", () => {
  let next = 0;
  const video = (spec: RowSpec): VideoRow => ({
    id: `row-${next++}`,
    platform: spec.platform,
    title: spec.title,
    publishedAt: spec.publishedAt,
    views: spec.views,
    durationSec: 300,
    likes: spec.likes ?? 0,
    comments: spec.comments ?? 0,
    ...given({
      coins: spec.coins,
      favorites: spec.favorites,
      shares: spec.shares,
      danmaku: spec.danmaku,
    }),
  });
  const bili = (
    title: string,
    views: number,
    extra: Partial<Omit<RowSpec, "platform" | "title" | "views">> = {},
  ): VideoRow =>
    video({ platform: "bilibili", title, publishedAt: AGED, views, ...extra });
  const yt = (
    title: string,
    views: number,
    extra: Partial<Omit<RowSpec, "platform" | "title" | "views">> = {},
  ): VideoRow =>
    video({ platform: "youtube", title, publishedAt: AGED, views, ...extra });

  const snapshot: AnalyticsSnapshot = {
    schema: "channel-analytics/1",
    generatedAt: "2026-11-25T12:00:00.000Z",
    notes: [],
    rows: [
      // Bilibili: a lane with a rate, a lane with one video, a lane that
      // just launched.
      bili("为什么军官要定期轮岗", 100, { likes: 5 }),
      bili("为什么预备役存在？", 200, { likes: 5, coins: 10 }),
      bili("府兵、募兵与义务兵", 300, { likes: 5 }),
      bili("停战而非和平：朝鲜战争", 20, { likes: 5 }),
      bili("AI 时代的软件定价", 1000, { likes: 100 }),
      bili("中印欧神话对比③", 150, { likes: 3, publishedAt: YOUNG }),
      bili("Pangu, Purusha & Ymir", 50, { likes: 1, publishedAt: YOUNG }),
      // YouTube: Shorts carry the views; nothing has a comment.
      yt("为什么航母拦阻着舰是最危险的常规作业 #Shorts", 900, { likes: 10 }),
      yt("朝鲜战争从未正式结束 #Shorts", 400, {
        likes: 5,
        publishedAt: "2026-11-21",
      }),
      yt("兵源制度的历史沿革：军队缺人怎么办？ #Shorts", 100, { likes: 1 }),
      yt("The Brier Score Explained: Why Overconfident AI Loses", 50, {
        likes: 2,
      }),
      yt("Reliable AI Agents: Why Carlo's Pizza Needs Evidence", 30),
      yt("AI Shadow Mode: How It Earns the Right to Act", 20, { likes: 1 }),
      yt("Don t Raise a Red Flag", 500),
    ],
  };

  it("counts, pooled rates, and lane tables by hand", () => {
    const a = analyze(snapshot, TODAY);
    expect(a.counts).toEqual({ youtube: 7, bilibili: 7 });
    expect(a.pooledCore.bilibili).toBeCloseTo(124 / 1820);
    expect(a.pooledCore.youtube).toBeCloseTo(19 / 2000);

    const military = a.lanes.find(
      (stat) => stat.platform === "bilibili" && stat.lane === "军制与战争史",
    )!;
    // 100, 200, 300, 20 views over 15 days: 6.7, 13.3, 20, 1.3 → median 10.
    expect(military).toMatchObject({ n: 4, views: 620, youngN: 0 });
    expect(military.medianViewsPerDay).toBeCloseTo(10);
    expect(military.coreRate).toBeCloseTo(20 / 620);

    // The lane that just launched: no rate, but its size is on record.
    const myth = a.lanes.find(
      (stat) => stat.platform === "bilibili" && stat.lane === "神话比较",
    )!;
    expect(myth).toMatchObject({
      n: 2,
      youngN: 2,
      youngMedianViews: 100,
      youngMaxViews: 150,
      medianViewsPerDay: null,
    });

    // Bilibili lanes, best first; YouTube lanes after them.
    expect(a.lanes.map((stat) => `${stat.platform}:${stat.lane}`)).toEqual([
      "bilibili:经济与就业",
      "bilibili:军制与战争史",
      "bilibili:神话比较",
      "youtube:军制与战争史",
      "youtube:其他",
      "youtube:AI可靠性与决策",
    ]);
  });

  it("ranks Bilibili engagement by everything a viewer can do, not only likes", () => {
    const { engagementLeaders } = analyze(snapshot, TODAY);
    // 5 likes + 10 coins on 200 views outranks 5 likes on 100.
    expect(engagementLeaders.bilibili.map((row) => row.views)).toEqual([
      // …and the tie at 2% goes to the video more people saw.
      20, 1000, 200, 100, 150,
    ]);
  });

  it("names as undervalued what few saw and those few valued", () => {
    const { undervalued } = analyze(snapshot, TODAY);
    // Bilibili pools 6.8%: 25% on 20 views clears twice that, 10% on 1000
    // does not.
    expect(undervalued.bilibili.map((row) => row.title)).toEqual([
      "停战而非和平：朝鲜战争",
    ]);
    // YouTube pools 0.95%: 5% and 4% clear twice that, 1% does not.
    expect(undervalued.youtube.map((row) => [row.views, row.likes])).toEqual([
      [20, 1],
      [50, 2],
    ]);
  });

  it("splits YouTube into Shorts and long-form, and by language", () => {
    const a = analyze(snapshot, TODAY);
    // Shorts: 60, 100, 6.7 a day → 60. Long: 3.3, 2, 1.3, 33.3 → 2.7.
    expect(a.shortsVsLong?.shorts.n).toBe(3);
    expect(a.shortsVsLong?.shorts.medianViewsPerDay).toBeCloseTo(60);
    expect(a.shortsVsLong?.long.medianViewsPerDay).toBeCloseTo(8 / 3);
    expect(a.language.youtube?.zh.n).toBe(3);
    expect(a.language.youtube?.en.n).toBe(4);
    // One Bilibili title is English ("Pangu, Purusha & Ymir").
    expect(a.language.bilibili?.zh.n).toBe(6);
    expect(a.language.bilibili?.en.n).toBe(1);
  });

  it("says when a platform reports no comments at all", () => {
    expect(analyze(snapshot, TODAY).notes).toEqual([
      expect.stringContaining("评论很可能已关闭"),
    ]);
    const withComments = analyze(
      {
        ...snapshot,
        rows: snapshot.rows.map((row, index) =>
          index === 7 ? { ...row, comments: 1 } : row,
        ),
      },
      TODAY,
    );
    expect(withComments.notes).toEqual([]);
  });

  it("measures what each video gained since the previous snapshot", () => {
    const flag = snapshot.rows[13]!;
    const previous: AnalyticsSnapshot = {
      schema: "channel-analytics/1",
      generatedAt: "2026-11-11T12:00:00.000Z",
      notes: [],
      rows: [
        { ...flag, views: 400 },
        // The same id on another platform is another video.
        { ...snapshot.rows[0]!, platform: "youtube", views: 1 },
      ],
    };
    const a = analyze(snapshot, TODAY, previous);
    expect(a.prevDate).toBe("2026-11-11");
    expect(a.gainedSincePrev.youtube).toEqual([
      {
        row: expect.objectContaining({ title: "Don t Raise a Red Flag" }),
        gained: 100,
      },
    ]);
    expect(a.gainedSincePrev.bilibili).toEqual([]);
    expect(analyze(snapshot, TODAY).gainedSincePrev.youtube).toEqual([]);
  });

  it("the digest leads with the platform split, sizes a launch, and never names the leftover lane", () => {
    const digest = renderDigest(analyze(snapshot, TODAY));
    const all = digest.join("\n");
    expect(digest[0]).toMatch(
      /^平台分工：YouTube 的量来自 Shorts（播放\/天中位 60\.0，n=3），YouTube 长视频只有 2\.7（n=4），Bilibili 长视频 13\.3（n=7）/,
    );
    // One video is not a lane leader: the 1000-view pricing video stays out.
    expect(all).not.toContain("经济与就业 66");
    // A lane that just launched has no daily rate — and is still evidence.
    expect(digest).toContain(
      "Bilibili 新发布（不足 3 天，尚无日均）：神话比较 2 部、目前中位 100/最高 150 播放",
    );
    expect(digest).toContain(
      "YouTube 赛道 播放/天（中位）领先：军制与战争史 60.0/天（n=3，互动率 1.1%）；垫底：AI可靠性与决策 2.0/天（n=3，互动率 3.0%）",
    );
    expect(digest).toContain(
      "YouTube 赛道 互动率（赞+评/播放）最高：AI可靠性与决策 3.0%（n=3），最低：军制与战争史 1.1%（n=3）",
    );
    expect(all).toContain(
      "Bilibili 低播放高互动（值得续作/重拍）：停战而非和平：朝鲜战争（25.0%，20 播放）",
    );
    // "Don t Raise a Red Flag" is the best views/day of YouTube's long-form —
    // and it is the leftover lane, which is not a subject.
    expect(all).not.toContain("Red Flag");
    expect(all).not.toContain("其他");
  });

  it("renders the digest first and the comparison last", () => {
    const report = renderReport(
      analyze(snapshot, TODAY, {
        schema: "channel-analytics/1",
        generatedAt: "2026-11-11T12:00:00.000Z",
        notes: [],
        rows: [{ ...snapshot.rows[0]!, views: 50 }],
      }),
    );
    const at_ = (heading: string): number => report.indexOf(heading);
    expect(at_("## 评委证据摘要")).toBeGreaterThan(at_("# 频道分析"));
    expect(at_("## 评委证据摘要")).toBeLessThan(
      at_("## 1. 题材赛道 × 播放与参与"),
    );
    expect(at_("## 1. 题材赛道 × 播放与参与")).toBeLessThan(
      at_("## 3. 长度 × 参与度"),
    );
    expect(at_("## 7. 播放/天 TOP10（发布 ≥ 3 天）")).toBeLessThan(
      at_("## 8. 与上次（2026-11-11）对比"),
    );
    expect(report).toContain(
      "| 平台 | 赛道 | 部数 | 播放/天(中位) | 互动率 | 完播率(中位) | 新发布(部/中位/最高播放) |",
    );
    expect(report).toContain(
      "| Bilibili | 神话比较 | 2 | — | 2.0% | — | 2/100/150 |",
    );
    expect(report).toContain(
      "+50 | 累计 100 | 军制与战争史 | 为什么军官要定期轮岗",
    );
  });
});

// ---------------------------------------------------------------- pulls

type Handler = (url: URL, init: RequestInit) => Response | undefined;

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

interface Seen {
  url: URL;
  init: RequestInit;
}

/** A fetch that answers from a handler and remembers what it was asked. */
function fakeFetch(handler: Handler): FetchImpl & { requests: Seen[] } {
  const requests: Seen[] = [];
  const impl: FetchImpl = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    requests.push({ url, init: init ?? {} });
    return (
      handler(url, init ?? {}) ?? new Response("no route", { status: 404 })
    );
  };
  return Object.assign(impl, { requests });
}

const header = (seen: Seen, name: string): string | null =>
  new Headers(seen.init.headers).get(name);

const noWait = async (): Promise<void> => {};

const youtubeVideos = {
  v1: {
    id: "v1",
    snippet: {
      title: "为什么航母拦阻着舰 #Shorts",
      publishedAt: "2026-11-21T08:00:00Z",
    },
    contentDetails: { duration: "PT2M51S" },
    statistics: { viewCount: "989", likeCount: "12", commentCount: "0" },
    status: { privacyStatus: "public" },
  },
  v2: { id: "v2", status: { privacyStatus: "private" } },
  v3: {
    id: "v3",
    snippet: {
      title: "Reliable AI Agents",
      publishedAt: "2026-11-25T01:00:00Z",
    },
    contentDetails: { duration: "PT10M1S" },
    statistics: { viewCount: "7" },
    status: { privacyStatus: "public" },
  },
};

const youtubeRoutes: Handler = (url) => {
  if (url.hostname === "oauth2.googleapis.com") {
    return jsonResponse(200, { access_token: "tok" });
  }
  if (url.pathname === "/youtube/v3/channels") {
    return jsonResponse(200, {
      items: [{ contentDetails: { relatedPlaylists: { uploads: "UU1" } } }],
    });
  }
  if (url.pathname === "/youtube/v3/playlistItems") {
    return url.searchParams.get("pageToken") === "p2"
      ? jsonResponse(200, { items: [{ contentDetails: { videoId: "v3" } }] })
      : jsonResponse(200, {
          items: [
            { contentDetails: { videoId: "v1" } },
            { contentDetails: { videoId: "v2" } },
          ],
          nextPageToken: "p2",
        });
  }
  if (url.pathname === "/youtube/v3/videos") {
    return jsonResponse(200, {
      items: [youtubeVideos.v1, youtubeVideos.v2, youtubeVideos.v3],
    });
  }
  if (url.hostname === "youtubeanalytics.googleapis.com") {
    return jsonResponse(403, {
      error: {
        message:
          "YouTube Analytics API has not been used in project 1 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/youtubeanalytics/overview?project=1 then retry.",
        errors: [{ reason: "accessNotConfigured" }],
      },
    });
  }
  return undefined;
};

const creds = { clientId: "cid", clientSecret: "sec", refreshToken: "rt" };

describe("pullYouTube", () => {
  it("reads the channel's public videos across pages, with their engagement", async () => {
    const fetchImpl = fakeFetch(youtubeRoutes);
    const { rows, notes } = await pullYouTube(creds, {
      fetchImpl,
      sleep: noWait,
    });
    expect(rows).toEqual([
      {
        platform: "youtube",
        id: "v1",
        title: "为什么航母拦阻着舰 #Shorts",
        durationSec: 171,
        publishedAt: "2026-11-21",
        views: 989,
        likes: 12,
        comments: 0,
      },
      {
        platform: "youtube",
        id: "v3",
        title: "Reliable AI Agents",
        durationSec: 601,
        publishedAt: "2026-11-25",
        views: 7,
        likes: 0,
        comments: 0,
      },
    ]);
    // The playlist is read from the account, and the uploads are paged.
    expect(
      fetchImpl.requests.map(
        ({ url }) =>
          `${url.hostname}${url.pathname}${url.searchParams.get("pageToken") ?? ""}`,
      ),
    ).toEqual([
      "oauth2.googleapis.com/token",
      "www.googleapis.com/youtube/v3/channels",
      "www.googleapis.com/youtube/v3/playlistItems",
      "www.googleapis.com/youtube/v3/playlistItemsp2",
      "www.googleapis.com/youtube/v3/videos",
      "youtubeanalytics.googleapis.com/v2/reports",
    ]);
    // A missing Analytics API is a note on the report, not a failed pull.
    expect(notes).toEqual([
      "完播率/订阅转化不可用：YouTube Analytics API 未在此项目启用，启用后自动出现：https://console.developers.google.com/apis/api/youtubeanalytics/overview?project=1",
    ]);
  });

  it("carries the token on every Data API call and nowhere else", async () => {
    const fetchImpl = fakeFetch(youtubeRoutes);
    await pullYouTube(creds, { fetchImpl, sleep: noWait });
    const [tokenCall, ...apiCalls] = fetchImpl.requests;
    expect(header(tokenCall!, "Authorization")).toBeNull();
    expect(
      apiCalls.every((seen) => header(seen, "Authorization") === "Bearer tok"),
    ).toBe(true);
  });

  it("adds retention when the Analytics API answers", async () => {
    const withAnalytics: Handler = (url, init) =>
      url.hostname === "youtubeanalytics.googleapis.com"
        ? jsonResponse(200, {
            columnHeaders: [
              { name: "video" },
              { name: "averageViewPercentage" },
              { name: "subscribersGained" },
            ],
            rows: [
              ["v1", 42.5, 3],
              ["v3", 61.25, 0],
            ],
          })
        : youtubeRoutes(url, init);
    const { rows, notes } = await pullYouTube(creds, {
      fetchImpl: fakeFetch(withAnalytics),
      sleep: noWait,
    });
    expect(notes).toEqual([]);
    expect(
      rows.map((row) => [row.retentionPct, row.subscribersGained]),
    ).toEqual([
      [42.5, 3],
      [61.25, 0],
    ]);
  });

  it("an upload-only token is reported as the command that fixes it", async () => {
    const scoped: Handler = (url, init) =>
      url.pathname === "/youtube/v3/channels"
        ? jsonResponse(403, {
            error: {
              message: "Request had insufficient authentication scopes.",
              errors: [{ reason: "insufficientPermissions" }],
            },
          })
        : youtubeRoutes(url, init);
    await expect(
      pullYouTube(creds, { fetchImpl: fakeFetch(scoped), sleep: noWait }),
    ).rejects.toThrow(/video youtube --auth --scope manage/);
  });

  it("a rejected refresh token is reported the same way", async () => {
    const rejected: Handler = (url) =>
      url.hostname === "oauth2.googleapis.com"
        ? jsonResponse(400, {
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          })
        : undefined;
    await expect(
      pullYouTube(creds, { fetchImpl: fakeFetch(rejected), sleep: noWait }),
    ).rejects.toThrow(/--scope manage.*token refresh failed/);
  });

  it("parses YouTube's durations", () => {
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT4M")).toBe(240);
    expect(parseIsoDuration("PT59S")).toBe(59);
    expect(parseIsoDuration("P1D")).toBe(0);
    expect(parseIsoDuration("")).toBe(0);
  });
});

const WBI = {
  img: "7cd084941338484aae1ad9425b84077c",
  sub: "4932caff0ff746eab6f01bf08b70ac45",
};

const bilibiliRoutes: Handler = (url) => {
  if (url.pathname === "/x/web-interface/nav") {
    return jsonResponse(200, {
      code: 0,
      data: {
        wbi_img: {
          img_url: `https://i0.hdslb.com/bfs/wbi/${WBI.img}.png`,
          sub_url: `https://i0.hdslb.com/bfs/wbi/${WBI.sub}.png`,
        },
      },
    });
  }
  if (url.pathname === "/x/space/wbi/arc/search") {
    return url.searchParams.get("pn") === "1"
      ? jsonResponse(200, {
          code: 0,
          data: {
            list: {
              vlist: [
                {
                  bvid: "BV1",
                  title: "视频一",
                  length: "06:56",
                  created: 1763000000,
                },
                {
                  bvid: "BV2",
                  title: "视频二",
                  length: 125,
                  created: 1763000001,
                },
              ],
            },
          },
        })
      : jsonResponse(200, { code: 0, data: { list: { vlist: [] } } });
  }
  if (url.pathname === "/x/web-interface/view") {
    return url.searchParams.get("bvid") === "BV1"
      ? jsonResponse(200, {
          code: 0,
          data: {
            stat: {
              view: 164,
              danmaku: 2,
              reply: 3,
              favorite: 9,
              coin: 4,
              share: 1,
              like: 12,
            },
          },
        })
      : jsonResponse(200, { code: -404, message: "稿件不存在" });
  }
  return undefined;
};

describe("pullBilibili", () => {
  const NOW = 1_700_000_000_000;

  it("lists the channel, then reads every action a viewer took on each video", async () => {
    const fetchImpl = fakeFetch(bilibiliRoutes);
    const slept: number[] = [];
    const { rows, notes } = await pullBilibili("SESSDATA=s; bili_jct=x", {
      fetchImpl,
      sleep: async (ms) => {
        slept.push(ms);
      },
      now: () => NOW,
    });
    expect(rows).toEqual([
      {
        platform: "bilibili",
        id: "BV1",
        title: "视频一",
        durationSec: 416,
        publishedAt: localDate(new Date(1763000000 * 1000).toISOString()),
        views: 164,
        likes: 12,
        comments: 3,
        coins: 4,
        favorites: 9,
        shares: 1,
        danmaku: 2,
      },
    ]);
    expect(notes).toEqual([
      "1 个 B 站视频读取统计失败（已删除或审核中），已跳过",
    ]);
    // Both listing pages, then one request per video, one pause between them.
    expect(fetchImpl.requests.map(({ url }) => url.pathname)).toEqual([
      "/x/web-interface/nav",
      "/x/space/wbi/arc/search",
      "/x/space/wbi/arc/search",
      "/x/web-interface/view",
      "/x/web-interface/view",
    ]);
    expect(
      fetchImpl.requests
        .filter(({ url }) => url.pathname.includes("arc/search"))
        .map(({ url }) => url.searchParams.get("pn")),
    ).toEqual(["1", "2"]);
    expect(slept).toEqual([120]);
  });

  it("sends the session, the referer and a signed query", async () => {
    const fetchImpl = fakeFetch(bilibiliRoutes);
    await pullBilibili("SESSDATA=s; bili_jct=x", {
      fetchImpl,
      sleep: noWait,
      now: () => NOW,
    });
    const nav = fetchImpl.requests[0]!;
    expect(header(nav, "Cookie")).toBe("SESSDATA=s; bili_jct=x");
    expect(header(nav, "Referer")).toBe("https://www.bilibili.com/");
    expect(header(nav, "User-Agent")).toContain("Mozilla");
    const listing = fetchImpl.requests[1]!.url;
    expect(listing.searchParams.get("mid")).toBe("1710879058");
    expect(listing.searchParams.get("wts")).toBe(String(NOW / 1000));
    expect(listing.searchParams.get("w_rid")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("signs a request the way Bilibili's own algorithm does", () => {
    // The expected string comes from the Python implementation this
    // replaced, which had been pulling the channel live for weeks.
    const signed = wbiSign(
      {
        mid: "1710879058",
        pn: "1",
        ps: "50",
        tid: "0",
        keyword: "",
        order: "pubdate",
        platform: "web",
        web_location: "1550101",
      },
      WBI.img,
      WBI.sub,
      NOW / 1000,
    );
    const [query, rid] = signed.split("&w_rid=");
    expect(query).toBe(
      "keyword=&mid=1710879058&order=pubdate&platform=web&pn=1&ps=50&tid=0&web_location=1550101&wts=1700000000",
    );
    expect(rid).toBe("0f3a1eff3bd3b41f37fee6f1358b1d6b");
  });

  it("an expired login is named, never reported as a channel with no videos", async () => {
    const loggedOut: Handler = (url, init) =>
      url.pathname === "/x/web-interface/nav"
        ? jsonResponse(200, { code: -101, message: "账号未登录" })
        : bilibiliRoutes(url, init);
    await expect(
      pullBilibili("SESSDATA=stale", {
        fetchImpl: fakeFetch(loggedOut),
        sleep: noWait,
      }),
    ).rejects.toThrow(/code -101.*login cookies expired/);

    const allGone: Handler = (url) =>
      url.pathname === "/x/web-interface/view"
        ? jsonResponse(200, { code: -404, message: "稿件不存在" })
        : bilibiliRoutes(url, {});
    await expect(
      pullBilibili("SESSDATA=s", {
        fetchImpl: fakeFetch(allGone),
        sleep: noWait,
      }),
    ).rejects.toThrow(/every video/);
  });

  it("a rate-limit rejection says to wait, not that the channel is empty", async () => {
    const limited: Handler = (url) =>
      url.pathname === "/x/web-interface/nav"
        ? new Response("", { status: 412 })
        : undefined;
    await expect(
      pullBilibili("SESSDATA=s", {
        fetchImpl: fakeFetch(limited),
        sleep: noWait,
      }),
    ).rejects.toThrow(/HTTP 412.*wait a minute/);
  });

  it("parses the listing's lengths", () => {
    expect(parseBilibiliLength("06:56")).toBe(416);
    expect(parseBilibiliLength("1:02:03")).toBe(3723);
    expect(parseBilibiliLength(125)).toBe(125);
    expect(parseBilibiliLength("")).toBe(0);
    expect(parseBilibiliLength(undefined)).toBe(0);
    expect(parseBilibiliLength("soon")).toBe(0);
  });
});

describe("reads into untrusted JSON", () => {
  it("walks objects and arrays, and stops at anything else", () => {
    expect(at({ a: { b: [{ c: 7 }] } }, "a", "b", "0", "c")).toBe(7);
    expect(at({ a: 1 }, "b")).toBeUndefined();
    expect(at({ a: { b: 1 } }, "a", "b", "c")).toBeUndefined();
    expect(at(null, "a")).toBeUndefined();
    expect(at(["x"], "0")).toBe("x");
    expect(at([{ a: 1 }], "5", "a")).toBeUndefined();
  });

  it("reads a number the platform sent either way, and nothing else as one", () => {
    expect(count(12)).toBe(12);
    expect(count("989")).toBe(989);
    expect(count("42.5")).toBe(42.5);
    expect(count("")).toBeUndefined();
    expect(count("views")).toBeUndefined();
    expect(count(null)).toBeUndefined();
    expect(count(Number.NaN)).toBeUndefined();
  });

  it("the pull's error carries the status it was given", () => {
    const err = new ChannelAnalyticsError("m", 403, "insufficientPermissions");
    expect(err).toBeInstanceOf(Error);
    expect([err.status, err.reason]).toEqual([403, "insufficientPermissions"]);
  });
});

// ---------------------------------------------------------------- command

describe("runChannelAnalytics", () => {
  /** Noon UTC on the 25th: the 25th in every zone from UTC-11 to UTC+11. */
  const NOW = Date.parse("2026-11-25T12:00:00.000Z");
  const TODAY_RUN = localDate(new Date(NOW).toISOString());

  let root: string;
  let savedHome: string | undefined;
  let savedToken: string | undefined;
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origErr = console.error;

  const snapshot = (views: number): AnalyticsSnapshot => ({
    schema: "channel-analytics/1",
    generatedAt: "2026-11-25T12:00:00.000Z",
    notes: [],
    rows: [
      {
        platform: "bilibili",
        id: "BV1",
        title: "为什么军官要定期轮岗",
        durationSec: 188,
        publishedAt: AGED,
        views,
        likes: 2,
        comments: 0,
        coins: 1,
      },
    ],
  });
  const dir = (): string => path.join(root, "docs", "analytics");
  const write = (name: string, content: string): void => {
    mkdirSync(dir(), { recursive: true });
    writeFileSync(path.join(dir(), name), content, "utf8");
  };
  /** A home directory that holds the three files the pull reads. */
  const fakeHome = (cookies: boolean): string => {
    const home = path.join(root, "home");
    const secrets = path.join(home, ".config", "secrets");
    mkdirSync(secrets, { recursive: true });
    writeFileSync(
      path.join(secrets, "client_secret_youtube.json"),
      JSON.stringify({ installed: { client_id: "cid", client_secret: "sec" } }),
    );
    writeFileSync(
      path.join(secrets, "ai.env"),
      "OTHER=x\nYOUTUBE_REFRESH_TOKEN=file-token\n",
    );
    if (cookies) {
      writeFileSync(
        path.join(secrets, "biliup-cookies.json"),
        JSON.stringify({
          cookie_info: {
            cookies: [
              { name: "SESSDATA", value: "sess" },
              { name: "not-a-session-cookie", value: "no" },
            ],
          },
        }),
      );
    }
    process.env["HOME"] = home;
    return home;
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "video-analytics-"));
    savedHome = process.env["HOME"];
    savedToken = process.env["YOUTUBE_REFRESH_TOKEN"];
    logs.length = 0;
    errors.length = 0;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    if (savedHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = savedHome;
    if (savedToken === undefined) delete process.env["YOUTUBE_REFRESH_TOKEN"];
    else process.env["YOUTUBE_REFRESH_TOKEN"] = savedToken;
    rmSync(root, { recursive: true, force: true });
  });

  it("--offline re-renders today's report from the saved snapshot, with no network", async () => {
    write("2026-11-19-data.json", JSON.stringify(snapshot(60)));
    write(`${TODAY_RUN}-data.json`, JSON.stringify(snapshot(90)));
    const fetchImpl = vi.fn(() => {
      throw new Error("the network must not be touched");
    }) as unknown as FetchImpl;
    expect(
      await runChannelAnalytics({
        cwd: root,
        offline: true,
        deps: { fetchImpl },
      }),
    ).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    const report = readFileSync(
      path.join(dir(), `${TODAY_RUN}-report.md`),
      "utf8",
    );
    expect(report).toContain("# 频道分析");
    expect(report).toContain("为什么军官要定期轮岗");
    expect(logs.join("\n")).toContain("re-rendered from the");
  });

  it("--offline without a snapshot for today is an exit 1 that says what to run", async () => {
    expect(await runChannelAnalytics({ cwd: root, offline: true })).toBe(1);
    expect(errors.join("\n")).toMatch(
      /no snapshot .* run `video analytics` once without --offline/,
    );
  });

  it("the previous snapshot is the newest one that is not today's", () => {
    write("2026-11-04-data.json", JSON.stringify(snapshot(1)));
    write(
      "2026-11-11-data.json",
      JSON.stringify({
        ...snapshot(2),
        generatedAt: "2026-11-11T09:00:00.000Z",
      }),
    );
    write(`${TODAY_RUN}-data.json`, JSON.stringify(snapshot(3)));
    write("2026-11-12-data.json", "{ not json");
    expect(previousSnapshot(dir(), TODAY_RUN)?.rows[0]?.views).toBe(2);
    expect(previousSnapshot(path.join(root, "nope"), TODAY_RUN)).toBeNull();
  });

  it("pulls both platforms, writes the snapshot and the report, and says where", async () => {
    fakeHome(true);
    // The shell still holds the previous token; the file holds the fresh one.
    process.env["YOUTUBE_REFRESH_TOKEN"] = "env-token";
    const both: Handler = (url, init) =>
      youtubeRoutes(url, init) ?? bilibiliRoutes(url, init);
    const fetchImpl = fakeFetch(both);
    expect(
      await runChannelAnalytics({
        cwd: root,
        deps: { fetchImpl, sleep: noWait, now: () => NOW },
      }),
    ).toBe(0);

    // The file's token wins over the environment's, and is never printed.
    expect(String(fetchImpl.requests[0]!.init.body)).toContain(
      "refresh_token=file-token",
    );
    expect(`${logs.join("\n")}${errors.join("\n")}`).not.toContain(
      "file-token",
    );
    // Only the session cookies ride along.
    const nav = fetchImpl.requests.find(
      ({ url }) => url.pathname === "/x/web-interface/nav",
    )!;
    expect(header(nav, "Cookie")).toBe("SESSDATA=sess");

    const data = JSON.parse(
      readFileSync(path.join(dir(), `${TODAY_RUN}-data.json`), "utf8"),
    ) as AnalyticsSnapshot;
    expect(data.generatedAt).toBe("2026-11-25T12:00:00.000Z");
    expect(data.rows.map((row) => `${row.platform}:${row.id}`)).toEqual([
      "youtube:v1",
      "youtube:v3",
      "bilibili:BV1",
    ]);
    expect(data.notes).toEqual([
      expect.stringContaining("未在此项目启用"),
      "1 个 B 站视频读取统计失败（已删除或审核中），已跳过",
    ]);
    expect(
      readFileSync(path.join(dir(), `${TODAY_RUN}-report.md`), "utf8"),
    ).toContain("## 评委证据摘要");
    const out = logs.join("\n");
    expect(out).toMatch(/✓ YouTube 2 部公开 · Bilibili 1 部/);
    expect(out).toContain(`report → docs/analytics/${TODAY_RUN}-report.md`);
    expect(out).toContain("对比：无更早的快照（首次）");
    expect(out).toContain("! 完播率/订阅转化不可用");
  });

  it("compares against an earlier snapshot when there is one", async () => {
    fakeHome(true);
    write(
      "2026-11-11-data.json",
      JSON.stringify({
        ...snapshot(100),
        generatedAt: "2026-11-11T09:00:00.000Z",
        rows: [
          { ...snapshot(100).rows[0]!, views: 100 },
          {
            ...snapshot(100).rows[0]!,
            platform: "youtube",
            id: "v1",
            views: 900,
          },
        ],
      }),
    );
    const both: Handler = (url, init) =>
      youtubeRoutes(url, init) ?? bilibiliRoutes(url, init);
    expect(
      await runChannelAnalytics({
        cwd: root,
        deps: { fetchImpl: fakeFetch(both), sleep: noWait, now: () => NOW },
      }),
    ).toBe(0);
    expect(logs.join("\n")).toContain("对比：2026-11-11 的快照");
    expect(
      readFileSync(path.join(dir(), `${TODAY_RUN}-report.md`), "utf8"),
    ).toContain("## 8. 与上次（2026-11-11）对比");
  });

  it("a missing cookie file is an exit 1 that names the file — and no report", async () => {
    const home = fakeHome(false);
    delete process.env["YOUTUBE_REFRESH_TOKEN"];
    expect(
      await runChannelAnalytics({
        cwd: root,
        deps: {
          fetchImpl: fakeFetch(youtubeRoutes),
          sleep: noWait,
          now: () => NOW,
        },
      }),
    ).toBe(1);
    expect(errors.join("\n")).toMatch(
      new RegExp(
        `bilibili cookies not found: ${home}/\\.config/secrets/biliup-cookies\\.json`,
      ),
    );
    expect(existsSync(path.join(dir(), `${TODAY_RUN}-report.md`))).toBe(false);
  });
});
