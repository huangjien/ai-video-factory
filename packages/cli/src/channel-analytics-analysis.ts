/**
 * Channel analytics — the analysis behind `video analytics`, and the one
 * thing the backlog judge is allowed to learn from.
 *
 * Pure: rows in, findings out. The pulls live in
 * `channel-analytics-pull.ts`, the command in `channel-analytics.ts`.
 *
 * Five dimensions, each answering a different question:
 *
 *  - length      — how long should the next video be?
 *  - ENGAGEMENT  — what did the audience VALUE, not merely click?
 *    (likes, comments, and on Bilibili coins, favorites, shares, danmaku)
 *  - topic lane  — which subject areas carry the channel?
 *  - format      — Shorts against long-form
 *  - language    — Chinese against English
 *
 * Views say what was clicked; engagement says what was valued. A lane
 * with views and no engagement is a click, not an appetite, so both are
 * computed and both reach the judge — in a digest at the very top of the
 * report, because the judge embeds only its first REPORT_PROMPT_CAP
 * characters. The evidence that moves a ranking cannot sit behind a table
 * of counts.
 */

export type Platform = "youtube" | "bilibili";

export type Lane =
  | "神话比较"
  | "军制与战争史"
  | "经济与就业"
  | "艺术考古与文明"
  | "叙事思维与数学"
  | "AI可靠性与决策"
  | "AI与软件工程"
  | "组织与管理"
  | "心理与沟通"
  | "其他";

export interface VideoRow {
  platform: Platform;
  id: string;
  title: string;
  durationSec: number;
  /** `YYYY-MM-DD`. */
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  /** Bilibili only. */
  coins?: number;
  favorites?: number;
  shares?: number;
  danmaku?: number;
  /** YouTube Analytics API only — present when that API is enabled. */
  retentionPct?: number;
  subscribersGained?: number;
}

export interface AnalyticsSnapshot {
  schema: "channel-analytics/1";
  generatedAt: string;
  rows: VideoRow[];
  /** Why a dimension is missing, when one is. */
  notes: string[];
}

export interface CohortStat {
  n: number;
  /** Over videos at least MIN_AGE_DAYS old; null when none is. */
  medianViewsPerDay: number | null;
  /** Every video's total views — the yardstick a launch is measured
   *  against, since a video too young for a rate has none. */
  medianViews: number | null;
  coreRate: number | null;
}

export interface LengthStat {
  bucket: string;
  n: number;
  views: number;
  meanViews: number;
  medianViews: number;
  maxViews: number;
  medianViewsPerDay: number | null;
  likeRate: number | null;
  commentRate: number | null;
  coreRate: number | null;
  /** Bilibili's extra actions; null on YouTube. */
  coinRate: number | null;
  favoriteRate: number | null;
  shareRate: number | null;
  danmakuRate: number | null;
}

export interface LaneStat {
  lane: Lane;
  platform: Platform;
  n: number;
  /** The lane's pooled views — the weight its rate deserves. */
  views: number;
  /** Over videos at least MIN_AGE_DAYS old; null when none is. */
  medianViewsPerDay: number | null;
  /** The videos younger than that — too new for a rate, but a launch is
   *  news the judge must not miss: how many, and their median and best
   *  views so far (a median alone hid a 135-view episode behind nine quiet
   *  ones). */
  youngN: number;
  youngMedianViews: number | null;
  youngMaxViews: number | null;
  coreRate: number | null;
  medianRetentionPct: number | null;
}

export interface Analysis {
  today: string;
  generatedAt: string;
  counts: Record<Platform, number>;
  /** Every video of the platform, young and old. */
  overall: Record<Platform, CohortStat>;
  pooledCore: Record<Platform, number | null>;
  length: Record<Platform, LengthStat[]>;
  /** Bilibili first, then by median views/day — the judge reads top-down. */
  lanes: LaneStat[];
  /** YouTube only: Shorts against everything else. Null without both. */
  shortsVsLong: { shorts: CohortStat; long: CohortStat } | null;
  language: Record<Platform, { zh: CohortStat; en: CohortStat } | null>;
  /** Views ≥ MIN_VIEWS_FOR_RATE, best core engagement first. */
  engagementLeaders: Record<Platform, VideoRow[]>;
  /** Views ≥ GEM_MIN_VIEWS and at least GEM_RATE_FACTOR times the
   *  platform's pooled core rate: seen by few, valued by those who did. */
  undervalued: Record<Platform, VideoRow[]>;
  topViewsPerDay: Record<Platform, VideoRow[]>;
  prevDate: string | null;
  /** Views gained since the previous snapshot, per platform, best first. */
  gainedSincePrev: Record<Platform, { row: VideoRow; gained: number }[]>;
  notes: string[];
  /** The backlog's open ideas against each lane's demand; null when the
   *  caller passed no backlog. Never part of the judge's evidence. */
  supply: SupplyRow[] | null;
}

// ---------------------------------------------------------------- lanes

/** Ordered; the FIRST match names the lane, so the order is the policy.
 *
 *  Specific subjects come first. Then the narrow AI-reliability lane — its
 *  keywords are only the channel's own reliability themes, because the
 *  obvious ones (`failure`, `cache`, `decision`, `wrong`) also name
 *  ordinary engineering and swallowed a third of the catalogue on the
 *  first run. Then titles that name an agent, then the organization lane,
 *  and only then the two broad software rules: `AI与软件工程` appears
 *  three times for that reason. The last of them is the catch-all for
 *  plain software engineering.
 *
 *  The rules were tuned against the real catalogue (272 videos, both
 *  languages) until every lane read as one subject; the titles that were
 *  hardest to place are the fixtures in the test. */
const LANE_RULES: ReadonlyArray<readonly [Lane, RegExp]> = [
  [
    "神话比较",
    /神话|myth|盘古|pangu|伊米尔|ymir|原人|purusha|封神|国民性|national character|human-divine|人神|创世|creation stor|女娲|nuwa|zeus|gilga|enlil|yuga|王权|should you rule|divine|毗湿奴|vishnu|奥丁|odin|荷鲁斯|horus|诺亚|方舟|apollo|雅典娜|athena|indra|因陀罗|湿婆|shiva|梵天|brahma/,
  ],
  [
    "军制与战争史",
    /(?<!冠)军|(?<!神)兵|役|舰|航母|战机|战斗机|战场|战争|停战|停火|战略|战术|战役|战史|伏击|游击|演习|假想敌|着舰|拦阻|步兵|班排|一个班|特警|侦察|特种|卫戍|戍边|战俘|逃兵|总参谋|编制|轮岗|预备役|府兵|募兵|义务兵|玄武门|孙子|兰彻斯特|\bwar\b|militar|\barm(y|ies)\b|officer|soldier|deserter|navy|naval|fleet|air force|aviation|squad|brigade|battalion|regiment|division|command|staff|reserve|conscription|draft notice|rotat|carrier|guerrilla|ambush|korean|xuanwu|sun tzu|lanchester|veteran|troop|recruit|swat|ceasefire|\bdmz\b|fubing|volunteer arm|20 tons/,
  ],
  [
    "经济与就业",
    /利率|interest rate|deposit rate|失业|unemploy|就业|招聘|hiring|firing|裁员|layoff|定价|pricing|付费|席位|\bseats\b|价格|经济|economy|收入|revenue|生意|business|银行|存款|工资|薪|pay for|\bjobs?\b/,
  ],
  [
    "艺术考古与文明",
    /图坦卡蒙|tutankhamun|面部重建|facial reconstruction|古人|\bancient\b|绘画|painting|gongbi|工笔|颜料|palette|留白|negative space|马远|ma yuan|铁剑|sword|文明|civilization|bronze|青铜|艺术|artist|考古|archaeolog|雕像|sculpture|壁画|mural|文艺复兴|renaissance|甲骨|oracle bone|象形|hieroglyph|金字塔|pyramid|木乃伊|mummy|化石|fossil|恐龙|dinosaur|进化|evolution|物种|species|金属|metal/,
  ],
  [
    "心理与沟通",
    /心理|psycholog|焦虑|社会比较|排名焦虑|lazy|努力|吃苦|冲突|conflict|分歧|说服|沟通|矛盾|情绪|self-help|自律|拖延|procrastinat/,
  ],
  [
    "叙事思维与数学",
    /小说|novel|fiction|\bwrit(e|es|ing|er|ers|ten)\b|写作|写故事|写小说|编剧|情节|说书|悬念|叙事|读者|翻页|storytel|narrative|科幻|创作|作者|sci-fi|worldbuild|\bplots?\b|\bstor(y|ies)\b|因果|causal|概率|probab|鸽巢|pigeonhole|聊斋|liaozhai|命数|禄数|measure of a life|billion-heartbeat|思想实验|thought experiment|数学|math|最后一个人|last man|李约瑟|needham|必然|impossib|决定论|determinism/,
  ],
  [
    "AI可靠性与决策",
    /幻觉|hallucinat|nonsense|胡说|影子模式|shadow mode|brier|布里尔|校准|calibrat|overconfiden|过度自信|更自信|invariant|不变量|巧合|coincidence|grades its own|批改|给裁判打分|谁来给裁判|llm-as-a-judge|reliable ai|unreliable|可靠|误报|false alarm|cried wolf|狼来了|silent failure|无声/,
  ],
  ["AI与软件工程", /\bagents?\b|智能体|agentic/],
  [
    "组织与管理",
    /组织|organization|organisat|团队|\bteam|管理|manag|扁平|maslow|马斯洛|政治|politic|领导|leadership|微操|micromanag|任务式指挥|auftrag|公司|company|经理|职场|career|流程|层级|hierarchy|治理|governance/,
  ],
  ["AI与软件工程", /\bai\b|llm|大模型|gpt|diffusion|扩散/],
  [
    "AI与软件工程",
    /模型|model|代码|code|架构|architecture|\bddd\b|领域建模|domain modeling|devops|token|prompt|\brag\b|\bmcp\b|\bapps?\b|\bapi\b|康威|conway|分布式|distributed|软件|software|engineer|工程|编程|program|language|界面|运维|部署|系统设计|system design|算法|algorithm|langchain|推理|inference|prefill|decode|place name|编码|cloud|自动化|automation|skill|技能|frontend|前端|后端|backend|\bweb\b|internet|互联网|developer|开发者|需求|requirement/,
  ],
];

const FALLBACK_LANE: Lane = "其他";

/** The subject area a title belongs to. A keyword rule, deliberately:
 *  free, deterministic, and the same for every run — an LLM classifier
 *  would make the judge's evidence depend on another model's mood. */
export function laneOf(title: string): Lane {
  const text = title.toLowerCase();
  for (const [lane, pattern] of LANE_RULES) {
    if (pattern.test(text)) return lane;
  }
  return FALLBACK_LANE;
}

const CJK = /[\u4e00-\u9fff]/;

/** The title's language — Chinese when it carries any CJK character,
 *  English otherwise. A bilingual title counts as Chinese: that is the
 *  audience it was written for. */
export function langOf(title: string): "zh" | "en" {
  return CJK.test(title) ? "zh" : "en";
}

/** Both platforms tag Shorts in the title, and nothing else marks them
 *  without an extra API call. */
export function isShortTitle(title: string): boolean {
  return /#shorts?\b/i.test(title);
}

export const LENGTH_BUCKETS = [
  [0, 120, "<2min"],
  [120, 240, "2-4min"],
  [240, 360, "4-6min"],
  [360, 600, "6-10min"],
  [600, 1200, "10-20min"],
  [1200, Number.POSITIVE_INFINITY, "20min+"],
] as const;

export function bucketOf(durationSec: number): string {
  for (const [from, to, name] of LENGTH_BUCKETS) {
    if (durationSec >= from && durationSec < to) return name;
  }
  // A NaN duration matches no bucket; it reads as the longest one.
  return "20min+";
}

// ---------------------------------------------------------------- metrics

const DAY_MS = 24 * 60 * 60 * 1000;

/** A video's first days carry its launch spike; a rate computed on them
 *  flatters whatever was published yesterday. */
export const MIN_AGE_DAYS = 3;

/** Below this a rate is noise — one like on three views is 33%. */
export const MIN_VIEWS_FOR_RATE = 20;

const GEM_MIN_VIEWS = 10;
const GEM_RATE_FACTOR = 2;
const LIST_CAP = 5;
const TOP_VIEWS_CAP = 10;
const DIGEST_GEMS = 3;
/** A lane with fewer videos than this is an anecdote; it is tabled but
 *  never named as a leader or a laggard in the digest. */
const MIN_LANE_N = 3;

// ---- supply vs demand
/** A lane is WATCHED when its median views/day is this many times its
 *  platform's. */
const DEMAND_VIEWS_FACTOR = 2;
/** …VALUED when its engagement rate is this many times its platform's, on
 *  at least MIN_VIEWS_FOR_RATE views. */
const DEMAND_ENGAGEMENT_FACTOR = 1.5;
/** …or LAUNCHED BIG when its best video younger than MIN_AGE_DAYS has
 *  this many times the platform's median views. */
const DEMAND_LAUNCH_FACTOR = 5;
/** Fewer open ideas than this, in a lane in demand. */
const THIN_SUPPLY = 4;
/** At least this many open ideas, in a lane not in demand. */
const GLUT_SUPPLY = 10;

export function ageDays(publishedAt: string, today: string): number {
  const published = Date.parse(publishedAt);
  const now = Date.parse(today);
  if (!Number.isFinite(published) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.round((now - published) / DAY_MS));
}

export function viewsPerDay(row: VideoRow, today: string): number {
  return row.views / Math.max(ageDays(row.publishedAt, today), 1);
}

/** Likes plus comments — the one engagement both platforms report, and
 *  the only rate that can be compared across them. */
export function coreEngagement(row: VideoRow): number {
  return row.likes + row.comments;
}

/** Everything a viewer can do to a video. Bilibili-only actions are
 *  absent on YouTube, where this equals `coreEngagement`. */
export function totalEngagement(row: VideoRow): number {
  return (
    coreEngagement(row) +
    (row.coins ?? 0) +
    (row.favorites ?? 0) +
    (row.shares ?? 0) +
    (row.danmaku ?? 0)
  );
}

export function coreRate(row: VideoRow): number {
  return coreEngagement(row) / row.views;
}

export function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Sum of engagements over sum of views — pooled, so one popular video
 *  outweighs ten unseen ones instead of being averaged as their equal. */
export function pooledRate(
  rows: ReadonlyArray<VideoRow>,
  engagement: (row: VideoRow) => number = coreEngagement,
): number | null {
  const views = rows.reduce((sum, row) => sum + row.views, 0);
  if (views === 0) return null;
  return rows.reduce((sum, row) => sum + engagement(row), 0) / views;
}

// ---------------------------------------------------------------- analysis

function cohort(rows: ReadonlyArray<VideoRow>, today: string): CohortStat {
  const aged = rows.filter(
    (row) => ageDays(row.publishedAt, today) >= MIN_AGE_DAYS,
  );
  return {
    n: rows.length,
    medianViewsPerDay: median(aged.map((row) => viewsPerDay(row, today))),
    medianViews: median(rows.map((row) => row.views)),
    coreRate: pooledRate(rows),
  };
}

function lengthStats(
  rows: ReadonlyArray<VideoRow>,
  today: string,
  platform: Platform,
): LengthStat[] {
  const extra = platform === "bilibili";
  const out: LengthStat[] = [];
  for (const [, , bucket] of LENGTH_BUCKETS) {
    const grp = rows.filter((row) => bucketOf(row.durationSec) === bucket);
    if (grp.length === 0) continue;
    const views = grp.map((row) => row.views).sort((a, b) => a - b);
    const total = views.reduce((sum, value) => sum + value, 0);
    const aged = grp.filter(
      (row) => ageDays(row.publishedAt, today) >= MIN_AGE_DAYS,
    );
    const extraRate = (
      pick: (row: VideoRow) => number | undefined,
    ): number | null =>
      extra ? pooledRate(grp, (row) => pick(row) ?? 0) : null;
    out.push({
      bucket,
      n: grp.length,
      views: total,
      meanViews: total / views.length,
      medianViews: median(views)!,
      maxViews: views[views.length - 1]!,
      medianViewsPerDay: median(aged.map((row) => viewsPerDay(row, today))),
      likeRate: pooledRate(grp, (row) => row.likes),
      commentRate: pooledRate(grp, (row) => row.comments),
      coreRate: pooledRate(grp),
      coinRate: extraRate((row) => row.coins),
      favoriteRate: extraRate((row) => row.favorites),
      shareRate: extraRate((row) => row.shares),
      danmakuRate: extraRate((row) => row.danmaku),
    });
  }
  return out;
}

const LANE_ORDER: Lane[] = [
  "军制与战争史",
  "神话比较",
  "AI可靠性与决策",
  "AI与软件工程",
  "组织与管理",
  "艺术考古与文明",
  "叙事思维与数学",
  "经济与就业",
  "心理与沟通",
  "其他",
];

function laneStats(
  rows: ReadonlyArray<VideoRow>,
  today: string,
  platform: Platform,
): LaneStat[] {
  const out: LaneStat[] = [];
  for (const lane of LANE_ORDER) {
    const grp = rows.filter((row) => laneOf(row.title) === lane);
    if (grp.length === 0) continue;
    const aged = grp.filter(
      (row) => ageDays(row.publishedAt, today) >= MIN_AGE_DAYS,
    );
    const young = grp.filter(
      (row) => ageDays(row.publishedAt, today) < MIN_AGE_DAYS,
    );
    out.push({
      lane,
      platform,
      n: grp.length,
      views: grp.reduce((sum, row) => sum + row.views, 0),
      medianViewsPerDay: median(aged.map((row) => viewsPerDay(row, today))),
      youngN: young.length,
      youngMedianViews: median(young.map((row) => row.views)),
      youngMaxViews:
        young.length === 0 ? null : Math.max(...young.map((row) => row.views)),
      coreRate: pooledRate(grp),
      medianRetentionPct: median(
        grp.flatMap((row) =>
          row.retentionPct === undefined ? [] : [row.retentionPct],
        ),
      ),
    });
  }
  // A lane nothing has been watched long enough to rate goes last.
  return out.sort(
    (a, b) =>
      (b.medianViewsPerDay ?? -1) - (a.medianViewsPerDay ?? -1) ||
      LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane),
  );
}

function languageSplit(
  rows: ReadonlyArray<VideoRow>,
  today: string,
): { zh: CohortStat; en: CohortStat } | null {
  const zh = rows.filter((row) => langOf(row.title) === "zh");
  const en = rows.filter((row) => langOf(row.title) === "en");
  return zh.length === 0 || en.length === 0
    ? null
    : { zh: cohort(zh, today), en: cohort(en, today) };
}

export function analyze(
  snapshot: AnalyticsSnapshot,
  today: string,
  previous?: AnalyticsSnapshot | null,
  openByLane?: Readonly<Record<Lane, number>>,
): Analysis {
  const perPlatform: Record<Platform, VideoRow[]> = {
    youtube: snapshot.rows.filter((row) => row.platform === "youtube"),
    bilibili: snapshot.rows.filter((row) => row.platform === "bilibili"),
  };
  const pooledCore: Record<Platform, number | null> = {
    youtube: pooledRate(perPlatform.youtube),
    bilibili: pooledRate(perPlatform.bilibili),
  };
  // Ranked by the rate the report PRINTS for that platform — core on
  // YouTube, everything on Bilibili — so the list reads in order.
  const engagementLeaders = (
    platform: Platform,
    rate: (row: VideoRow) => number,
  ): VideoRow[] =>
    perPlatform[platform]
      .filter(
        (row) => row.views >= MIN_VIEWS_FOR_RATE && coreEngagement(row) > 0,
      )
      .sort((a, b) => rate(b) - rate(a) || b.views - a.views)
      .slice(0, LIST_CAP);
  const undervalued = (platform: Platform): VideoRow[] => {
    const floor = pooledCore[platform];
    if (floor === null || floor === 0) return [];
    return perPlatform[platform]
      .filter(
        (row) =>
          row.views >= GEM_MIN_VIEWS &&
          coreRate(row) >= GEM_RATE_FACTOR * floor,
      )
      .sort((a, b) => coreRate(b) - coreRate(a))
      .slice(0, LIST_CAP);
  };
  const topViewsPerDay = (rows: VideoRow[]): VideoRow[] =>
    rows
      .filter((row) => ageDays(row.publishedAt, today) >= MIN_AGE_DAYS)
      .sort((a, b) => viewsPerDay(b, today) - viewsPerDay(a, today))
      .slice(0, TOP_VIEWS_CAP);
  const gained = (platform: Platform): { row: VideoRow; gained: number }[] => {
    if (previous === undefined || previous === null) return [];
    const before = new Map(
      previous.rows.map(
        (row) => [`${row.platform}:${row.id}`, row.views] as const,
      ),
    );
    return perPlatform[platform]
      .map((row) => ({
        row,
        gained:
          row.views - (before.get(`${row.platform}:${row.id}`) ?? row.views),
      }))
      .filter((entry) => entry.gained > 0)
      .sort((a, b) => b.gained - a.gained)
      .slice(0, LIST_CAP);
  };
  const shorts = perPlatform.youtube.filter((row) => isShortTitle(row.title));
  const long = perPlatform.youtube.filter((row) => !isShortTitle(row.title));
  const analysis: Analysis = {
    today,
    generatedAt: snapshot.generatedAt,
    counts: {
      youtube: perPlatform.youtube.length,
      bilibili: perPlatform.bilibili.length,
    },
    overall: {
      youtube: cohort(perPlatform.youtube, today),
      bilibili: cohort(perPlatform.bilibili, today),
    },
    pooledCore,
    length: {
      youtube: lengthStats(perPlatform.youtube, today, "youtube"),
      bilibili: lengthStats(perPlatform.bilibili, today, "bilibili"),
    },
    lanes: [
      ...laneStats(perPlatform.bilibili, today, "bilibili"),
      ...laneStats(perPlatform.youtube, today, "youtube"),
    ],
    shortsVsLong:
      shorts.length > 0 && long.length > 0
        ? { shorts: cohort(shorts, today), long: cohort(long, today) }
        : null,
    language: {
      youtube: languageSplit(perPlatform.youtube, today),
      bilibili: languageSplit(perPlatform.bilibili, today),
    },
    engagementLeaders: {
      youtube: engagementLeaders("youtube", coreRate),
      bilibili: engagementLeaders(
        "bilibili",
        (row) => totalEngagement(row) / row.views,
      ),
    },
    undervalued: {
      youtube: undervalued("youtube"),
      bilibili: undervalued("bilibili"),
    },
    topViewsPerDay: {
      youtube: topViewsPerDay(perPlatform.youtube),
      bilibili: topViewsPerDay(perPlatform.bilibili),
    },
    prevDate:
      previous === undefined || previous === null
        ? null
        : localDate(previous.generatedAt),
    gainedSincePrev: {
      youtube: gained("youtube"),
      bilibili: gained("bilibili"),
    },
    notes: [...snapshot.notes, ...derivedNotes(perPlatform.youtube)],
    supply: null,
  };
  // Supply is the backlog's business, not the numbers': the caller hands
  // it in when a backlog exists, and the report then says where the two
  // disagree.
  if (openByLane !== undefined) {
    analysis.supply = supplyRows(analysis, openByLane);
  }
  return analysis;
}

/** What the numbers say about themselves. A channel whose every YouTube
 *  video shows zero comments has comments switched off — read literally,
 *  the judge would take it for a silent audience. */
function derivedNotes(rows: ReadonlyArray<VideoRow>): string[] {
  if (rows.length === 0) return [];
  const comments = rows.reduce((sum, row) => sum + row.comments, 0);
  return comments === 0
    ? [
        "YouTube 全部视频的评论数为 0：评论很可能已关闭，「评论率 0」不代表观众沉默，请以点赞率为准",
      ]
    : [];
}

// ---------------------------------------------------------------- supply

/** A lane's open backlog ideas set against its demand. */
export interface SupplyRow {
  lane: Lane;
  /** Open backlog ideas (idea + proposed) in the lane. */
  open: number;
  /** The strongest signals, a platform named in each; empty when the lane
   *  is not in demand. */
  evidence: string[];
  /** `thin` — in demand with fewer open ideas than THIN_SUPPLY;
   *  `glut` — not in demand with at least GLUT_SUPPLY; `ample` — in
   *  demand and stocked; null when there is nothing to say. */
  verdict: "thin" | "glut" | "ample" | null;
}

/** What each lane is about, for a prompt that has to propose topics in
 *  it. The keyword rules FILE a title; these say what the lane means. */
export const LANE_GLOSS: Readonly<Record<Lane, string>> = {
  神话比较:
    "comparing Chinese, Indian and Greek mythology — creation, order, kingship, the human-divine boundary, time and disaster, national character",
  军制与战争史:
    "military institutions and the history of war — formations, conscription, reserves, staffs, doctrine, campaigns and armistices, told through their mechanisms",
  经济与就业:
    "the economy and work — pricing, jobs, unemployment, interest rates, the business behind software",
  艺术考古与文明:
    "art, archaeology and civilization — reconstructed ancient faces, the materials of painting, what ancient technology could and could not do",
  心理与沟通:
    "psychology and communication — motivation, comparison, conflict, and how people talk it through",
  叙事思维与数学:
    "narrative craft, thinking tools, and the mathematics behind things",
  AI可靠性与决策:
    "making AI and software trustworthy — calibration, hallucination, shadow deployment, judging the judge, silent failure",
  AI与软件工程:
    "AI systems and software engineering — agents, inference, modeling, architecture, devops",
  组织与管理:
    "organizations and management — teams, hierarchies, incentives, mission command",
  其他: "none of the channel's subject lanes",
};

/** Who each lane is written FOR.
 *
 * The drafter's default audience is "developers" — right for the software
 * lanes, wrong for the rest: a mythology episode drafted for developers
 * comes back as an access-control explainer (the same proposal scored
 * 81/100 that way and 97/100 once the audience was named). The lane
 * knows who watches it, so the lane names the audience.
 */
export const LANE_AUDIENCE: Readonly<Record<Lane, string>> = {
  神话比较:
    "对世界神话、宗教信仰与跨文化比较感兴趣的一般观众，偏人文社科，不是技术读者",
  军制与战争史: "对军事制度、战争史与兵制沿革感兴趣的一般读者与历史爱好者",
  经济与就业: "关心就业、利率与经济政策的一般观众",
  艺术考古与文明: "对艺术、考古与文明史感兴趣的一般观众，偏人文社科",
  心理与沟通: "关心心理机制与沟通方式的一般读者",
  叙事思维与数学: "对叙事、思考工具与数学趣味感兴趣的读者",
  AI可靠性与决策: "关心 AI 判断是否可靠、决策如何落地的从业者与爱好者",
  AI与软件工程: "做 AI 系统与软件工程的工程师与技术负责人",
  组织与管理: "带团队、做组织与管理的人，以及关注它们的读者",
  其他: "对该题材本身感兴趣的一般观众",
};

/** The audience a lane is written for, or null for a lane that has none. */
export function audienceForLane(lane: Lane | undefined): string | null {
  if (lane === undefined) return null;
  return LANE_AUDIENCE[lane] ?? null;
}

/** Every lane name — the runtime list behind the type. */
export const LANE_NAMES: readonly string[] = Object.keys(LANE_AUDIENCE);

const LANE_SET: ReadonlySet<string> = new Set(LANE_NAMES);

/** Is this string one of the lanes? */
export function isLane(value: string): value is Lane {
  return LANE_SET.has(value);
}

const emptyLanes = <T>(make: () => T): Record<Lane, T> => ({
  神话比较: make(),
  军制与战争史: make(),
  经济与就业: make(),
  艺术考古与文明: make(),
  心理与沟通: make(),
  叙事思维与数学: make(),
  AI可靠性与决策: make(),
  AI与软件工程: make(),
  组织与管理: make(),
  其他: make(),
});

/** `value / base` when `value` is at least `factor × base`; null when it
 *  is not, or when either side is missing. */
function clears(
  value: number | null,
  base: number | null,
  factor: number,
): number | null {
  if (value === null || base === null || base <= 0 || value < factor * base) {
    return null;
  }
  return value / base;
}

/** The numbers that make each lane worth feeding. A lane is in demand
 *  when, on EITHER platform, one of three things holds — it is watched,
 *  it is valued, or it just launched big (the three DEMAND_* factors).
 *  Calibrated on the real catalogue (2026-11-25): it names the lanes a
 *  reader of the report would name, and nothing whose whole evidence is
 *  two views. */
export function laneDemand(a: Analysis): Record<Lane, string[]> {
  const out = emptyLanes<string[]>(() => []);
  for (const lane of LANE_ORDER) {
    if (lane === FALLBACK_LANE) continue;
    const signals: {
      kind: number;
      ratio: number;
      platform: Platform;
      text: string;
    }[] = [];
    for (const platform of PLATFORMS) {
      const stat = a.lanes.find(
        (s) => s.platform === platform && s.lane === lane,
      );
      if (stat === undefined) continue;
      const overall = a.overall[platform];
      const push = (ratio: number | null, kind: number, text: string): void => {
        if (ratio !== null) {
          signals.push({
            kind,
            ratio,
            platform,
            text: `${PLATFORM_LABEL[platform]} ${text}`,
          });
        }
      };
      push(
        clears(
          stat.n >= 2 ? stat.medianViewsPerDay : null,
          overall.medianViewsPerDay,
          DEMAND_VIEWS_FACTOR,
        ),
        0,
        `播放/天 ${perDay(stat.medianViewsPerDay)}（频道中位 ${perDay(overall.medianViewsPerDay)}）`,
      );
      push(
        clears(
          stat.views >= MIN_VIEWS_FOR_RATE ? stat.coreRate : null,
          a.pooledCore[platform],
          DEMAND_ENGAGEMENT_FACTOR,
        ),
        1,
        `互动率 ${pct(stat.coreRate)}（频道 ${pct(a.pooledCore[platform])}）`,
      );
      push(
        clears(
          stat.youngN >= 2 ? stat.youngMaxViews : null,
          overall.medianViews,
          DEMAND_LAUNCH_FACTOR,
        ),
        2,
        `新发布 ${stat.youngN} 部、最高 ${stat.youngMaxViews} 播放（频道中位 ${overall.medianViews}）`,
      );
    }
    // The steadier signal first (watched, then valued, then a launch) and
    // the larger margin first within a kind — one line per platform.
    const chosen: string[] = [];
    const taken = new Set<Platform>();
    for (const signal of signals.sort(
      (x, y) => x.kind - y.kind || y.ratio - x.ratio,
    )) {
      if (taken.has(signal.platform)) continue;
      taken.add(signal.platform);
      chosen.push(signal.text);
      if (chosen.length === 2) break;
    }
    out[lane] = chosen;
  }
  return out;
}

/** Every lane's open backlog ideas set against its demand. The rows to
 *  act on come first: lanes to feed (fewest ideas first), then lanes to
 *  stop feeding (most ideas first), then the lanes in demand and stocked,
 *  then the rest — each group in lane order. */
export function supplyRows(
  a: Analysis,
  openByLane: Readonly<Record<Lane, number>>,
): SupplyRow[] {
  const demand = laneDemand(a);
  const actFirst: Record<NonNullable<SupplyRow["verdict"]> | "none", number> = {
    thin: 0,
    glut: 1,
    ample: 2,
    none: 3,
  };
  const rows = LANE_ORDER.map((lane): SupplyRow => {
    const evidence = demand[lane];
    const open = openByLane[lane] ?? 0;
    // The leftover lane is not a subject: never in demand, and a pile of
    // unfiled ideas is not a glut either.
    const inDemand = lane !== FALLBACK_LANE && evidence.length > 0;
    const verdict: SupplyRow["verdict"] = inDemand
      ? open < THIN_SUPPLY
        ? "thin"
        : "ample"
      : lane !== FALLBACK_LANE && open >= GLUT_SUPPLY
        ? "glut"
        : null;
    return { lane, open, evidence, verdict };
  });
  return rows.sort(
    (x, y) =>
      actFirst[x.verdict ?? "none"] - actFirst[y.verdict ?? "none"] ||
      (x.verdict === "thin" ? x.open - y.open : 0) ||
      (x.verdict === "glut" ? y.open - x.open : 0) ||
      LANE_ORDER.indexOf(x.lane) - LANE_ORDER.indexOf(y.lane),
  );
}

/** Open backlog ideas (idea + proposed) per lane, filed by the same rules
 *  as the channel's videos — so the report and the backlog agree on what
 *  a lane is. The note is read too: a bare topic is often too short to
 *  name its subject. */
export function countOpenByLane(
  ideas: ReadonlyArray<{
    topic: string;
    note?: string | undefined;
    status: string;
  }>,
): Record<Lane, number> {
  const out = emptyLanes<number>(() => 0);
  for (const idea of ideas) {
    if (idea.status !== "idea" && idea.status !== "proposed") continue;
    out[laneOf(`${idea.topic} ${idea.note ?? ""}`)] += 1;
  }
  return out;
}

/** `YYYY-MM-DD` of an ISO timestamp, in the machine's own zone. */
export function localDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso.slice(0, 10);
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------------------------------------------------------- rendering

const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  bilibili: "Bilibili",
};

const PLATFORMS: readonly Platform[] = ["bilibili", "youtube"];

const SUPPLY_LABEL: Record<NonNullable<SupplyRow["verdict"]> | "none", string> =
  {
    thin: "**供给不足**",
    glut: "**供给过剩**",
    ample: "供给充足",
    none: "—",
  };

const pct = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;

const perDay = (value: number | null): string =>
  value === null ? "—" : value.toFixed(1);

/** A title short enough for one table row. */
const clip = (title: string): string => {
  const t = title.trim();
  return t.length > 44 ? `${t.slice(0, 44)}…` : t;
};

const rowLine = (row: VideoRow, lead: string, today: string): string =>
  `- ${lead} | ${row.views} 播放 | ${ageDays(row.publishedAt, today)} 天 | ${laneOf(row.title)} | ${clip(row.title)}`;

const splitLine = (label: string, zh: CohortStat, en: CohortStat): string =>
  `${label} 中文 vs 英文：播放/天（中位）${perDay(zh.medianViewsPerDay)} vs ${perDay(en.medianViewsPerDay)}（n=${zh.n}/${en.n}）；互动率 ${pct(zh.coreRate)} vs ${pct(en.coreRate)}`;

/** The findings the judge is allowed to learn from — ranked, each with
 *  the numbers that produced it, each short enough to cite. */
export function renderDigest(a: Analysis): string[] {
  const out: string[] = [];
  // First, because it frames every lane number below it: the same lane
  // reads very differently on the two platforms, and on YouTube it is
  // the Shorts that carry the views.
  if (a.shortsVsLong !== null) {
    const { shorts, long } = a.shortsVsLong;
    const bili = a.overall.bilibili;
    out.push(
      `平台分工：YouTube 的量来自 Shorts（播放/天中位 ${perDay(shorts.medianViewsPerDay)}，n=${shorts.n}），YouTube 长视频只有 ${perDay(long.medianViewsPerDay)}（n=${long.n}），Bilibili 长视频 ${perDay(bili.medianViewsPerDay)}（n=${bili.n}）—— 题材表现以 Bilibili 和 YouTube Shorts 的数字为准，YouTube 长视频的低播放不代表题材差`,
    );
  }
  for (const platform of PLATFORMS) {
    const named = (stat: LaneStat): boolean =>
      stat.platform === platform && stat.lane !== FALLBACK_LANE;
    const rated = a.lanes.filter(
      (stat) =>
        named(stat) && stat.n >= MIN_LANE_N && stat.medianViewsPerDay !== null,
    );
    if (rated.length >= 2) {
      const show = (stat: LaneStat): string =>
        `${stat.lane} ${perDay(stat.medianViewsPerDay)}/天（n=${stat.n}，互动率 ${pct(stat.coreRate)}）`;
      // The laggard is never also named a leader: with two rated lanes
      // there is one leader and one laggard.
      const leaders = rated.slice(0, Math.min(2, rated.length - 1));
      out.push(
        `${PLATFORM_LABEL[platform]} 赛道 播放/天（中位）领先：${leaders.map(show).join("、")}；垫底：${show(rated[rated.length - 1]!)}`,
      );
    }
    // A lane that just launched has no daily rate yet — and is often the
    // most important thing on the channel. Its launch size is still evidence.
    const young = a.lanes
      .filter((stat) => named(stat) && (stat.youngMedianViews ?? 0) > 0)
      .sort((x, y) => (y.youngMedianViews ?? 0) - (x.youngMedianViews ?? 0));
    if (young.length > 0) {
      out.push(
        `${PLATFORM_LABEL[platform]} 新发布（不足 ${MIN_AGE_DAYS} 天，尚无日均）：${young.map((stat) => `${stat.lane} ${stat.youngN} 部、目前中位 ${stat.youngMedianViews}/最高 ${stat.youngMaxViews} 播放`).join("、")}`,
      );
    }
    const byRate = a.lanes
      .filter(
        (stat) =>
          named(stat) &&
          stat.coreRate !== null &&
          stat.views >= MIN_VIEWS_FOR_RATE,
      )
      .sort((x, y) => (y.coreRate ?? 0) - (x.coreRate ?? 0));
    if (byRate.length >= 2) {
      const best = byRate[0]!;
      const worst = byRate[byRate.length - 1]!;
      out.push(
        `${PLATFORM_LABEL[platform]} 赛道 互动率（赞+评/播放）最高：${best.lane} ${pct(best.coreRate)}（n=${best.n}），最低：${worst.lane} ${pct(worst.coreRate)}（n=${worst.n}）`,
      );
    }
  }
  for (const platform of PLATFORMS) {
    const buckets = a.length[platform].filter(
      (stat) => stat.n >= 3 && stat.medianViewsPerDay !== null,
    );
    if (buckets.length < 2) continue;
    const byViews = [...buckets].sort(
      (x, y) => (y.medianViewsPerDay ?? 0) - (x.medianViewsPerDay ?? 0),
    );
    const byRate = buckets
      .filter(
        (stat) => stat.coreRate !== null && stat.views >= MIN_VIEWS_FOR_RATE,
      )
      .sort((x, y) => (y.coreRate ?? 0) - (x.coreRate ?? 0));
    let line = `${PLATFORM_LABEL[platform]} 长度：播放/天（中位）最高 ${byViews[0]!.bucket} ${perDay(byViews[0]!.medianViewsPerDay)}（n=${byViews[0]!.n}）`;
    if (byRate.length > 0) {
      line += `；互动率最高 ${byRate[0]!.bucket} ${pct(byRate[0]!.coreRate)}（n=${byRate[0]!.n}）`;
    }
    out.push(line);
  }
  for (const platform of ["youtube", "bilibili"] as const) {
    const split = a.language[platform];
    if (split !== null) {
      out.push(splitLine(PLATFORM_LABEL[platform], split.zh, split.en));
    }
  }
  for (const platform of PLATFORMS) {
    const gems = a.undervalued[platform];
    if (gems.length === 0) continue;
    out.push(
      `${PLATFORM_LABEL[platform]} 低播放高互动（值得续作/重拍）：${gems
        .slice(0, DIGEST_GEMS)
        .map(
          (row) =>
            `${clip(row.title)}（${pct(coreRate(row))}，${row.views} 播放）`,
        )
        .join("、")}`,
    );
  }
  const retention = a.lanes.filter((stat) => stat.medianRetentionPct !== null);
  if (retention.length >= 2) {
    const sorted = [...retention].sort(
      (x, y) => (y.medianRetentionPct ?? 0) - (x.medianRetentionPct ?? 0),
    );
    out.push(
      `完播率（YouTube）：最高 ${sorted[0]!.lane} ${(sorted[0]!.medianRetentionPct ?? 0).toFixed(0)}%，最低 ${sorted[sorted.length - 1]!.lane} ${(sorted[sorted.length - 1]!.medianRetentionPct ?? 0).toFixed(0)}%`,
    );
  }
  return out;
}

export function renderReport(a: Analysis): string {
  // Sections after the lane table are numbered from 3 when the report has
  // a supply section and from 2 when it has not — never a gap.
  const section = (withSupply: number): number =>
    a.supply === null ? withSupply - 1 : withSupply;
  const lines: string[] = [
    `# 频道分析 ${a.today}`,
    "",
    `> YouTube 公开 ${a.counts.youtube} 部 · Bilibili ${a.counts.bilibili} 部 · 生成于 ${a.generatedAt}`,
    ...a.notes.map((note) => `> ${note}`),
    "",
    "## 评委证据摘要",
    "",
    ...renderDigest(a).map((finding) => `- ${finding}`),
    "",
    "## 1. 题材赛道 × 播放与参与",
    "",
    "| 平台 | 赛道 | 部数 | 播放/天(中位) | 互动率 | 完播率(中位) | 新发布(部/中位/最高播放) |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const stat of a.lanes) {
    lines.push(
      `| ${PLATFORM_LABEL[stat.platform]} | ${stat.lane} | ${stat.n} | ${perDay(stat.medianViewsPerDay)} | ${pct(stat.coreRate)} | ${stat.medianRetentionPct === null ? "—" : `${stat.medianRetentionPct.toFixed(0)}%`} | ${stat.youngN === 0 ? "—" : `${stat.youngN}/${stat.youngMedianViews ?? 0}/${stat.youngMaxViews ?? 0}`} |`,
    );
  }
  // Section 2 is for PEOPLE: it names the lanes the backlog cannot feed.
  // The judge reads up to the first "## 2." and never sees it — how many
  // ideas are waiting is not evidence about any one of them.
  if (a.supply !== null) {
    lines.push(
      "",
      "## 2. 供给 vs 需求（backlog 待选选题 × 频道表现）",
      "",
      `> 这一节给人看，不进评委的证据块。需求旺 = 该赛道在任一平台满足一条：播放/天 ≥ 频道中位 ${DEMAND_VIEWS_FACTOR} 倍（至少 2 部）；互动率 ≥ 频道 ${DEMAND_ENGAGEMENT_FACTOR} 倍（至少 ${MIN_VIEWS_FOR_RATE} 播放）；新发布（不足 ${MIN_AGE_DAYS} 天）最高播放 ≥ 频道中位 ${DEMAND_LAUNCH_FACTOR} 倍（至少 2 部）。需求旺而待选不足 ${THIN_SUPPLY} 条 = 供给不足；需求不旺而待选 ≥ ${GLUT_SUPPLY} 条 = 供给过剩。\`video backlog harvest\` 会为供给不足的赛道按需采集。`,
      "",
      "| 赛道 | 待选选题 | 需求证据 | 判断 |",
      "|---|---|---|---|",
    );
    for (const row of a.supply) {
      lines.push(
        `| ${row.lane} | ${row.open} | ${row.evidence.join("；") || "—"} | ${SUPPLY_LABEL[row.verdict ?? "none"]} |`,
      );
    }
  }
  lines.push("", `## ${section(3)}. 长度 × 播放`, "");
  for (const platform of ["youtube", "bilibili"] as const) {
    lines.push(
      `### ${PLATFORM_LABEL[platform]}（n=${a.counts[platform]}）`,
      "",
    );
    lines.push(
      "| 长度段 | 部数 | 总播放 | 均值 | 中位 | 最高 | 播放/天(中位) |",
      "|---|---|---|---|---|---|---|",
    );
    for (const stat of a.length[platform]) {
      lines.push(
        `| ${stat.bucket} | ${stat.n} | ${stat.views} | ${stat.meanViews.toFixed(1)} | ${stat.medianViews} | ${stat.maxViews} | ${perDay(stat.medianViewsPerDay)} |`,
      );
    }
    lines.push("");
  }
  lines.push(`## ${section(4)}. 长度 × 参与度`, "", "### YouTube", "");
  lines.push(
    "| 长度段 | 部数 | 播放 | 点赞率 | 评论率 | 核心互动率 |",
    "|---|---|---|---|---|---|",
  );
  for (const stat of a.length.youtube) {
    lines.push(
      `| ${stat.bucket} | ${stat.n} | ${stat.views} | ${pct(stat.likeRate)} | ${pct(stat.commentRate)} | ${pct(stat.coreRate)} |`,
    );
  }
  lines.push("", "### Bilibili", "");
  lines.push(
    "| 长度段 | 部数 | 播放 | 点赞率 | 投币率 | 收藏率 | 分享率 | 评论率 | 弹幕率 |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const stat of a.length.bilibili) {
    lines.push(
      `| ${stat.bucket} | ${stat.n} | ${stat.views} | ${pct(stat.likeRate)} | ${pct(stat.coinRate)} | ${pct(stat.favoriteRate)} | ${pct(stat.shareRate)} | ${pct(stat.commentRate)} | ${pct(stat.danmakuRate)} |`,
    );
  }
  lines.push("", `## ${section(5)}. 形式与语言`, "");
  if (a.shortsVsLong !== null) {
    const { shorts, long } = a.shortsVsLong;
    lines.push(
      `- YouTube Shorts vs 长视频：播放/天（中位）${perDay(shorts.medianViewsPerDay)} vs ${perDay(long.medianViewsPerDay)}（n=${shorts.n}/${long.n}）；互动率 ${pct(shorts.coreRate)} vs ${pct(long.coreRate)}`,
    );
  } else {
    lines.push("- YouTube：Shorts 或长视频缺一边，无法对比");
  }
  for (const platform of ["youtube", "bilibili"] as const) {
    const split = a.language[platform];
    lines.push(
      split === null
        ? `- ${PLATFORM_LABEL[platform]}：只有一种语言的标题，无法对比`
        : `- ${splitLine(PLATFORM_LABEL[platform], split.zh, split.en)}`,
    );
  }
  const bullets = (
    rows: VideoRow[],
    lead: (row: VideoRow) => string,
  ): string[] =>
    rows.length === 0
      ? ["- （暂无）"]
      : rows.map((row) => rowLine(row, lead(row), a.today));
  lines.push(
    "",
    `## ${section(6)}. 参与度领先（播放 ≥ ${MIN_VIEWS_FOR_RATE}）`,
    "",
    "### YouTube — 核心互动率（赞+评/播放）",
    ...bullets(a.engagementLeaders.youtube, (row) => pct(coreRate(row))),
    "",
    "### Bilibili — 综合互动率（赞+币+藏+享+评+弹 / 播放）",
    ...bullets(a.engagementLeaders.bilibili, (row) =>
      pct(totalEngagement(row) / row.views),
    ),
    "",
    `## ${section(7)}. 低播放高互动（被低估，值得续作/重拍）`,
  );
  for (const platform of PLATFORMS) {
    lines.push("", `### ${PLATFORM_LABEL[platform]}`);
    lines.push(
      ...bullets(a.undervalued[platform], (row) => pct(coreRate(row))),
    );
  }
  lines.push(
    "",
    `## ${section(8)}. 播放/天 TOP${TOP_VIEWS_CAP}（发布 ≥ ${MIN_AGE_DAYS} 天）`,
  );
  for (const platform of ["youtube", "bilibili"] as const) {
    lines.push("", `### ${PLATFORM_LABEL[platform]}`);
    lines.push(
      ...bullets(
        a.topViewsPerDay[platform],
        (row) => `${perDay(viewsPerDay(row, a.today))}/天`,
      ),
    );
  }
  if (a.prevDate !== null) {
    lines.push("", `## ${section(9)}. 与上次（${a.prevDate}）对比`);
    for (const platform of PLATFORMS) {
      lines.push(
        "",
        `### ${PLATFORM_LABEL[platform]} — 期间新增播放 TOP${LIST_CAP}`,
      );
      lines.push(
        ...(a.gainedSincePrev[platform].length === 0
          ? ["- （无可对比的新增）"]
          : a.gainedSincePrev[platform].map(
              ({ row, gained }) =>
                `- +${gained} | 累计 ${row.views} | ${laneOf(row.title)} | ${clip(row.title)}`,
            )),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
