import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { parseClientSecret, type YouTubeCredentials } from "@video/youtube";
import {
  analyze,
  countOpenByLane,
  localDate,
  renderReport,
  type AnalyticsSnapshot,
  type Lane,
  type SupplyRow,
} from "./channel-analytics-analysis.js";
import {
  at,
  ChannelAnalyticsError,
  pullBilibili,
  pullYouTube,
  text,
  type PullDeps,
} from "./channel-analytics-pull.js";
import { findRepoRoot } from "./learn-command.js";
import { backlogPath, loadBacklogStore } from "./backlog-store.js";
import { defaultClientSecretPath } from "./youtube-command.js";

/**
 * `video analytics` — pull the channel's numbers and write the report the
 * backlog judge ranks by.
 *
 *   video analytics             pull YouTube + Bilibili, write both files
 *   video analytics --offline   re-render today's report, no network
 *
 * Two files land in docs/analytics/, both named after today:
 *
 *   <date>-data.json    every video with every number — the raw snapshot,
 *                       untracked, and what "since last time" is measured
 *                       against
 *   <date>-report.md    the findings — tracked, and the ONLY thing the
 *                       judge reads (backlog-score.ts embeds its first
 *                       REPORT_PROMPT_CAP characters)
 *
 * The analysis is pure and tested (channel-analytics-analysis.ts); this
 * file only resolves credentials, calls the pulls, and writes the files.
 * A pull that cannot run is a non-zero exit with the fix in the message —
 * never a report that silently says the channel has no videos.
 */

export const ANALYTICS_DIR = "docs/analytics";
const DATA_SUFFIX = "-data.json";
const REPORT_SUFFIX = "-report.md";

/** Read at call time, not at import: `homedir()` follows `$HOME`, and a
 *  test points that at a fixture directory. */
const secretsDir = (): string => path.join(homedir(), ".config", "secrets");

export interface ChannelAnalyticsOptions {
  cwd?: string;
  /** Re-render today's report from the snapshot on disk: no network,
   *  no credentials. The way to iterate on the analysis itself. */
  offline?: boolean;
  /** Test seams: the fetch, the pauses, and the clock that names the
   *  files (`now`). */
  deps?: Partial<PullDeps>;
}

export async function runChannelAnalytics(
  opts: ChannelAnalyticsOptions = {},
): Promise<number> {
  const repoRoot = findRepoRoot(opts.cwd ?? process.cwd());
  const dir = path.join(repoRoot, ANALYTICS_DIR);
  const deps: PullDeps = { fetchImpl: fetch, ...opts.deps };
  const today = localDate(new Date(deps.now?.() ?? Date.now()).toISOString());
  const reportFile = path.join(dir, `${today}${REPORT_SUFFIX}`);
  const shown = (file: string): string => path.relative(repoRoot, file) || file;
  try {
    mkdirSync(dir, { recursive: true });
    // The backlog's open ideas are the other half of the picture: a lane
    // the audience rewards but the backlog cannot feed is a hole.
    const openByLane = openIdeasByLane(repoRoot);
    const reportSupply = (rows: SupplyRow[]): void => {
      for (const row of rows) {
        if (row.verdict === "thin") {
          console.log(
            `  供给不足：${row.lane}（${row.open} 条待选）— ${row.evidence.join("；")}`,
          );
        } else if (row.verdict === "glut") {
          console.log(`  供给过剩：${row.lane}（${row.open} 条待选）`);
        }
      }
    };
    if (opts.offline === true) {
      const snapshot = readSnapshot(path.join(dir, `${today}${DATA_SUFFIX}`));
      if (snapshot === null) {
        throw new ChannelAnalyticsError(
          `no snapshot for ${today} in ${ANALYTICS_DIR}/ — run \`video analytics\` once without --offline`,
        );
      }
      const analysis = analyze(
        snapshot,
        today,
        previousSnapshot(dir, today),
        openByLane,
      );
      writeFileSync(reportFile, renderReport(analysis), "utf8");
      console.log(
        `report → ${shown(reportFile)} (re-rendered from the ${today} snapshot)`,
      );
      reportSupply(analysis.supply ?? []);
      return 0;
    }
    const youtube = await pullYouTube(resolveYouTubeCredentials(), deps);
    const bilibili = await pullBilibili(loadBilibiliCookies(), deps);
    const snapshot: AnalyticsSnapshot = {
      schema: "channel-analytics/1",
      generatedAt: new Date(deps.now?.() ?? Date.now()).toISOString(),
      rows: [...youtube.rows, ...bilibili.rows],
      notes: [...youtube.notes, ...bilibili.notes],
    };
    const dataFile = path.join(dir, `${today}${DATA_SUFFIX}`);
    writeFileSync(dataFile, `${JSON.stringify(snapshot, null, 1)}\n`, "utf8");
    const analysis = analyze(
      snapshot,
      today,
      previousSnapshot(dir, today),
      openByLane,
    );
    writeFileSync(reportFile, renderReport(analysis), "utf8");
    console.log(
      `✓ YouTube ${analysis.counts.youtube} 部公开 · Bilibili ${analysis.counts.bilibili} 部`,
    );
    for (const note of analysis.notes) console.log(`  ! ${note}`);
    console.log(`report → ${shown(reportFile)}`);
    console.log(
      analysis.prevDate === null
        ? "  对比：无更早的快照（首次）"
        : `  对比：${analysis.prevDate} 的快照`,
    );
    reportSupply(analysis.supply ?? []);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}

/** The newest snapshot that is not today's — what "since last time"
 *  means. Unreadable or half-written files are ignored, not fatal. */
export function previousSnapshot(
  dir: string,
  today: string,
): AnalyticsSnapshot | null {
  return (
    newestSnapshot(dir, (name) => !name.startsWith(today))?.snapshot ?? null
  );
}

/** The newest snapshot on disk, with the file it came from — what the
 *  demand-led harvest reads to know which lanes the audience rewards. */
export function latestSnapshot(
  dir: string,
): { file: string; snapshot: AnalyticsSnapshot } | null {
  return newestSnapshot(dir);
}

function newestSnapshot(
  dir: string,
  accept: (name: string) => boolean = () => true,
): { file: string; snapshot: AnalyticsSnapshot } | null {
  if (!existsSync(dir)) return null;
  // Newest first, and the first one that READS wins: a half-written file
  // must not cost the report its comparison.
  const files = readdirSync(dir)
    .filter(
      (name) => /^\d{4}-\d{2}-\d{2}-data\.json$/.test(name) && accept(name),
    )
    .sort()
    .reverse();
  for (const name of files) {
    const file = path.join(dir, name);
    const snapshot = readSnapshot(file);
    if (snapshot !== null) return { file, snapshot };
  }
  return null;
}

/** The backlog's open ideas per lane — undefined when there is no backlog
 *  yet, so the report simply skips the supply section. */
function openIdeasByLane(repoRoot: string): Record<Lane, number> | undefined {
  // No backlog yet is not a backlog of zero ideas: a supply table full of
  // zeros would read as "every lane is starved".
  if (!existsSync(backlogPath(repoRoot))) return undefined;
  try {
    return countOpenByLane(loadBacklogStore(repoRoot).ideas);
  } catch {
    // A malformed backlog is the human's problem, not the report's: the
    // numbers still stand.
    return undefined;
  }
}

function readSnapshot(file: string): AnalyticsSnapshot | null {
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(at(parsed, "rows"))
      ? (parsed as AnalyticsSnapshot)
      : null;
  } catch {
    return null;
  }
}

/** The same credentials `video youtube` uploads with, read from where
 *  this machine keeps them. The token in `~/.config/secrets/ai.env` wins
 *  over the shell's `YOUTUBE_REFRESH_TOKEN`: the environment is a copy
 *  loaded when the shell started, and it is stale the moment a new token
 *  is stored (measured 2026-11-25: a fresh token in the file, the
 *  upload-only one still in the environment, and a 403). The token must
 *  carry a read scope — `--auth` alone mints an upload-only one. */
function resolveYouTubeCredentials(): YouTubeCredentials {
  const fix = "`video youtube --auth --scope manage`";
  const file = defaultClientSecretPath();
  if (!existsSync(file)) {
    throw new ChannelAnalyticsError(
      `YouTube client secret not found: ${file} — run ${fix} once`,
    );
  }
  const { clientId, clientSecret } = parseClientSecret(
    readFileSync(file, "utf8"),
  );
  const refreshToken =
    tokenFromEnvFile(path.join(secretsDir(), "ai.env")) ??
    process.env["YOUTUBE_REFRESH_TOKEN"];
  if (refreshToken === undefined) {
    throw new ChannelAnalyticsError(
      `no YOUTUBE_REFRESH_TOKEN in ~/.config/secrets/ai.env or the environment — run ${fix}`,
    );
  }
  return { clientId, clientSecret, refreshToken };
}

function tokenFromEnvFile(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((entry) => entry.startsWith("YOUTUBE_REFRESH_TOKEN="));
  return line === undefined
    ? undefined
    : line.slice("YOUTUBE_REFRESH_TOKEN=".length).trim();
}

/** The uploader's cookie file, reduced to the five names Bilibili's web
 *  API reads. Printed nowhere. */
export function loadBilibiliCookies(): string {
  const file = path.join(secretsDir(), "biliup-cookies.json");
  if (!existsSync(file)) {
    throw new ChannelAnalyticsError(
      `bilibili cookies not found: ${file} — export them from the uploader (biliup login)`,
    );
  }
  const wanted = [
    "SESSDATA",
    "bili_jct",
    "DedeUserID",
    "DedeUserID__ckMd5",
    "sid",
  ];
  const jar: string[] = [];
  const cookies = at(
    JSON.parse(readFileSync(file, "utf8")),
    "cookie_info",
    "cookies",
  );
  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    const name = text(at(cookie, "name"));
    const value = text(at(cookie, "value"));
    if (name !== undefined && value !== undefined && wanted.includes(name)) {
      jar.push(`${name}=${value}`);
    }
  }
  if (jar.length === 0) {
    throw new ChannelAnalyticsError(`no session cookies in ${file}`);
  }
  return jar.join("; ");
}

export function registerAnalytics(program: Command): void {
  program
    .command("analytics")
    .description(
      "pull the channel's YouTube + Bilibili numbers and write the report the backlog judge ranks by",
    )
    .option(
      "--cwd <dir>",
      "repo root (default: walk up to pnpm-workspace.yaml)",
    )
    .option(
      "--offline",
      "re-render today's report from the saved snapshot — no network, no credentials",
    )
    .action(async (opts: { cwd?: string; offline?: boolean }) => {
      process.exitCode = await runChannelAnalytics({
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.offline === true ? { offline: true } : {}),
      });
    });
}
