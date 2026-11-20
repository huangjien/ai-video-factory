import { existsSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { findRepoRoot } from "./learn-command.js";
import { loadBacklogStore, type BacklogEntry } from "./backlog-store.js";

/**
 * Backlog stats (design §read verbs): a pure read-only join between
 * backlog.yaml entries and the projects/<slug>/ trees they point at.
 * Every tier below is DERIVED from the filesystem at read time — nothing
 * here writes back to the store (store contract: derived values stay in
 * memory).
 *
 * Tier markers:
 * - drafted:  projects/<slug>/article.md
 * - rendered: projects/<slug>/output/final-mixed.mp4
 * - published: bilibili/bvid.txt (written by scripts/bilibili-upload.py
 *   on a successful upload). The YouTube path has no upload-success
 *   marker — youtube/package.yaml only proves the video was *packaged*,
 *   not published — so it is not used as a published signal here.
 */

export type BacklogTier = "none" | "drafted" | "rendered" | "published";

export interface BacklogAnomaly {
  id: string;
  reason: string;
}

export interface BacklogStats {
  total: number;
  counts: Record<BacklogTier, number>;
  bySource: { manual: number; harvest: number };
  /** Entries that reached Douyin (douyin/item_id.txt exists). Douyin is
   *  its own lane, not a tier: a film can be published on Douyin and
   *  nowhere else. */
  douyin: number;
  /** id → tier → project, only entries that reached drafted or beyond. */
  drafted: { id: string; tier: BacklogTier; project: string }[];
  anomalies: BacklogAnomaly[];
}

/** Which tier the project tree alone supports; callers take the max with
 *  "none" because a missing project dir means nothing was drafted. */
function tierForProject(projectRoot: string): BacklogTier {
  if (!existsSync(path.join(projectRoot, "article.md"))) return "none";
  if (!existsSync(path.join(projectRoot, "output", "final-mixed.mp4"))) {
    return "drafted";
  }
  if (!existsSync(path.join(projectRoot, "bilibili", "bvid.txt"))) {
    return "rendered";
  }
  return "published";
}

const TIER_ORDER: BacklogTier[] = ["none", "drafted", "rendered", "published"];

export function deriveBacklogStats(
  repoRoot: string,
  entries: BacklogEntry[],
): BacklogStats {
  const counts: Record<BacklogTier, number> = {
    none: 0,
    drafted: 0,
    rendered: 0,
    published: 0,
  };
  const bySource = { manual: 0, harvest: 0 };
  let douyin = 0;
  const drafted: BacklogStats["drafted"] = [];
  const anomalies: BacklogAnomaly[] = [];

  for (const entry of entries) {
    // "harvest:<relpath>" buckets together with other harvest sources —
    // the specific file path is provenance, not a distinct channel.
    if (entry.source === "manual") bySource.manual += 1;
    else bySource.harvest += 1;

    const tier =
      entry.project !== undefined
        ? tierForProject(path.join(repoRoot, "projects", entry.project))
        : "none";
    counts[tier] += 1;
    if (TIER_ORDER.indexOf(tier) > 0 && entry.project !== undefined) {
      drafted.push({ id: entry.id, tier, project: entry.project });
    }

    if (
      entry.project !== undefined &&
      existsSync(
        path.join(repoRoot, "projects", entry.project, "douyin", "item_id.txt"),
      )
    ) {
      douyin += 1;
    }

    // Hygiene: the store says drafted but the evidence is gone (no
    // project backfilled, or the projects/<slug>/ dir was deleted).
    if (entry.status === "drafted" && tier === "none") {
      anomalies.push({
        id: entry.id,
        reason:
          entry.project === undefined
            ? "status drafted but no project set"
            : "status drafted but projects dir missing",
      });
    }
  }

  return {
    total: entries.length,
    counts,
    bySource,
    douyin,
    drafted,
    anomalies,
  };
}

export async function runBacklogStats(opts: {
  cwd?: string;
  json?: boolean;
}): Promise<number> {
  const repoRoot = findRepoRoot(opts.cwd ?? process.cwd());
  if (!existsSync(path.join(repoRoot, "projects"))) {
    console.log("no projects/ directory yet — nothing to count");
    return 0;
  }
  const { ideas } = loadBacklogStore(repoRoot);
  if (ideas.length === 0) {
    console.log(
      "backlog is empty — add ideas with `video backlog add <topic>`",
    );
    return 0;
  }

  const stats = deriveBacklogStats(repoRoot, ideas);
  if (opts.json === true) {
    console.log(JSON.stringify(stats, null, 2));
    return 0;
  }

  console.log(`backlog entries: ${stats.total}`);
  console.log(
    `  drafted:  ${stats.counts.drafted + stats.counts.rendered + stats.counts.published}`,
  );
  console.log(`  rendered: ${stats.counts.rendered + stats.counts.published}`);
  console.log(`  published: ${stats.counts.published}`);
  console.log(`  douyin:    ${stats.douyin}`);
  console.log(
    `by source: manual ${stats.bySource.manual}, harvest ${stats.bySource.harvest}`,
  );
  if (stats.drafted.length > 0) {
    console.log("drafted:");
    for (const d of stats.drafted) {
      console.log(`  ${d.id}  ${d.tier}  ${d.project}`);
    }
  }
  if (stats.anomalies.length > 0) {
    console.error("hygiene warnings:");
    for (const a of stats.anomalies) {
      console.error(`  ${a.id}: ${a.reason}`);
    }
  }
  return 0;
}

export function addStatsCommand(backlog: Command): void {
  backlog
    .command("stats")
    .description("derived join counts: drafted/rendered/published per entry")
    .option("--json", "dump the full derived stats object as JSON")
    .option("--cwd <dir>", "repo root (default: walk up to pnpm-workspace.yaml)")
    .action(async (opts: { json?: boolean; cwd?: string }) => {
      process.exitCode = await runBacklogStats({
        ...(opts.json === true ? { json: true } : {}),
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      });
    });
}
