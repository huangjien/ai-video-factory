import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Command } from "commander";
import { formatRunId, writeRun } from "@video/workflow";
import { findRepoRoot } from "./learn-command.js";
import { slugifyProjectName } from "./project-path.js";
import {
  assertTransition,
  isStaleDrafting,
  loadBacklogStore,
  saveBacklogStore,
  type BacklogEntry,
} from "./backlog-store.js";
import { runDraftFromBacklog } from "./backlog-draft.js";
import { runMakeCli } from "./make-command.js";
import { runTranslate } from "./translate-command.js";
import { runBacklogJudge } from "./backlog-score.js";
import { runBacklogSchedule } from "./backlog-schedule.js";

/**
 * `video backlog auto` — the spare-capacity video factory.
 *
 * Fires ONLY when MiniMax has been idle for an hour AND the Token Plan
 * has ≥80% left in BOTH windows, then turns the judge's top-ranked open
 * idea into TWO finished MP4s (zh draft+make, en translate+make) without
 * a human gate. Refuses to run while another auto holds the lock or any
 * idea is stuck mid-pipeline — a failed render must never silently burn
 * the next idea. Designed to be poked hourly by launchd
 * (`--install-scheduler`, VIDEO_ASK=off); bare invocations run one check.
 */

export const AUTO_LABEL = "com.aivideofactory.backlog-auto";
const IDLE_THRESHOLD_MIN = 60;
const LOCK_STALE_MS = 3 * 60 * 60 * 1000;
const TOKEN_PLAN_URL = "https://api.minimax.io/v1/token_plan/remains";

export interface BacklogAutoOptions {
  dryRun?: boolean;
  /** Minimum remaining percent in BOTH Token Plan windows (default 80). */
  minRemaining?: number;
  installScheduler?: boolean;
  removeScheduler?: boolean;
  schedulerStatus?: boolean;
  cwd?: string;
  /** TEST SEAMS: quota fetch, launchd plist dir / binary / launchctl. */
  fetchImpl?: typeof fetch;
  plistDir?: string;
  videoPath?: string;
  runLaunchctl?: (args: string[]) => Promise<number>;
}

// --- trigger inputs -----------------------------------------------------

export interface MiniMaxQuota {
  intervalRemaining: number;
  weeklyRemaining: number;
}

/** Read the Token Plan quota. The `general` bucket covers LLM+TTS+image
 *  generation — the services this pipeline actually spends. */
export async function fetchMiniMaxQuota(
  fetchImpl: typeof fetch = fetch,
): Promise<MiniMaxQuota> {
  const key = process.env["MINIMAX_API_KEY"];
  if (key === undefined || key === "") {
    throw new Error("MINIMAX_API_KEY is not set — cannot read Token Plan quota");
  }
  const res = await fetchImpl(TOKEN_PLAN_URL, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`Token Plan API returned ${res.status}`);
  }
  const json = (await res.json()) as {
    model_remains?: Array<{
      model_name?: string;
      current_interval_remaining_percent?: number;
      current_weekly_remaining_percent?: number;
    }>;
  };
  const general = json.model_remains?.find((m) => m.model_name === "general");
  if (
    general === undefined ||
    typeof general.current_interval_remaining_percent !== "number" ||
    typeof general.current_weekly_remaining_percent !== "number"
  ) {
    throw new Error("Token Plan reply carries no general-bucket percentages");
  }
  return {
    intervalRemaining: general.current_interval_remaining_percent,
    weeklyRemaining: general.current_weekly_remaining_percent,
  };
}

function* filesUnder(dir: string, yamlOnly: boolean): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    let isFile = false;
    try {
      isFile = statSync(full).isFile();
    } catch {
      // vanished mid-scan — irrelevant for an idle estimate
      continue;
    }
    if (isFile && (!yamlOnly || name.endsWith(".yaml"))) yield full;
  }
}

function isMinimaxEvidence(file: string, stat: { mtimeMs: number }, now: number): boolean {
  // TTS and scene images leave no run record; their artifacts ARE the record.
  if (file.includes(`${path.sep}assets${path.sep}audio`) || file.includes(`${path.sep}assets${path.sep}images`)) {
    return true;
  }
  if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) return false;
  try {
    const text = readFileSync(file, "utf8");
    return /^\s*provider:\s*minimax/m.test(text);
  } catch {
    return false;
  }
}

/** Minutes since the last MiniMax touch (run records with a minimax
 *  provider, TTS audio, generated scene images). Infinity = no evidence
 *  in the looked-back window at all. */
export function minimaxIdleMinutes(
  repoRoot: string,
  now: number = Date.now(),
): number {
  const projectsDir = path.join(repoRoot, "projects");
  const candidates: string[] = [path.join(repoRoot, "runs"), path.join(projectsDir, "*", "runs"), path.join(projectsDir, "*", "assets", "audio"), path.join(projectsDir, "*", "assets", "images")]
    .flatMap((pattern) => {
      if (!pattern.includes("*")) return [pattern];
      const base = pattern.slice(0, pattern.indexOf("*"));
      if (!existsSync(base)) return [];
      return readdirSync(base)
        .map((name) => pattern.replace("*", name));
    });
  let newest = -1;
  for (const dir of candidates) {
    // Asset dirs scan EVERY file (scene-1.wav is TTS evidence); run-record
    // dirs only need their yaml records.
    const yamlOnly = !dir.includes(`${path.sep}assets${path.sep}`);
    for (const file of filesUnder(dir, yamlOnly)) {
      let mtime: number;
      try {
        mtime = statSync(file).mtimeMs;
      } catch {
        continue;
      }
      if (now - mtime > 24 * 60 * 60 * 1000) continue;
      if (!isMinimaxEvidence(file, { mtimeMs: mtime }, now)) continue;
      newest = Math.max(newest, mtime);
    }
  }
  if (newest < 0) return Number.POSITIVE_INFINITY;
  return (now - newest) / 60000;
}

// --- lock ---------------------------------------------------------------

const LOCK_FILE = "backlog-auto.lock";

function lockPath(repoRoot: string): string {
  return path.join(repoRoot, "runs", LOCK_FILE);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireAutoLock(
  repoRoot: string,
  now: number = Date.now(),
): { acquired: true } | { acquired: false; reason: string } {
  const target = lockPath(repoRoot);
  if (existsSync(target)) {
    try {
      const raw = parseYaml(readFileSync(target, "utf8")) as { pid?: number } | null;
      const pid = raw?.pid;
      if (typeof pid === "number" && pidAlive(pid)) {
        return { acquired: false, reason: `another backlog auto is running (pid ${pid})` };
      }
      const age = now - statSync(target).mtimeMs;
      if (age < LOCK_STALE_MS) {
        return { acquired: false, reason: `stale lock from a dead pid (written ${Math.round(age / 60000)} min ago) — delete ${path.relative(repoRoot, target)} to override` };
      }
      console.log(`  ! taking over a stale auto lock (>3h old, owner pid dead)`);
    } catch {
      return { acquired: false, reason: `unreadable lock at ${path.relative(repoRoot, target)}` };
    }
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `pid: ${process.pid}\ntaken: ${new Date(now).toISOString()}\n`, "utf8");
  return { acquired: true };
}

export function releaseAutoLock(repoRoot: string): void {
  unlinkSync(lockPath(repoRoot));
}

// --- pick ---------------------------------------------------------------

function newestJudgeRanking(repoRoot: string): { id: string; rank: number }[] | null {
  const runsDir = path.join(repoRoot, "runs");
  if (!existsSync(runsDir)) return null;
  const caches = readdirSync(runsDir)
    .filter((f) => /^backlog-judge-[0-9a-f]{64}\.yaml$/.test(f))
    .sort();
  for (const file of caches.reverse()) {
    try {
      const parsed = parseYaml(readFileSync(path.join(runsDir, file), "utf8")) as {
        ranking?: { id?: unknown; rank?: unknown }[];
      } | null;
      const rows = parsed?.ranking;
      if (!Array.isArray(rows)) continue;
      const ranking = rows
        .filter(
          (r): r is { id: string; rank: number } =>
            typeof r.id === "string" && typeof r.rank === "number",
        )
        .sort((a, b) => a.rank - b.rank);
      if (ranking.length > 0) return ranking;
    } catch {
      // unreadable cache — try the next-oldest one
    }
  }
  return null;
}

/** Highest-ranked OPEN entry from the judge cache; runs the judge first
 *  when no cache exists (one glm call). Returns a message on refusal. */
async function pickTopOpenId(
  repoRoot: string,
  store: { ideas: BacklogEntry[] },
): Promise<{ id?: string; message: string }> {
  const openIds = new Set(
    store.ideas.filter((e) => e.status === "idea" || e.status === "proposed").map((e) => e.id),
  );
  if (openIds.size === 0) {
    return { message: "no open entries — the backlog needs new ideas (harvest or add)" };
  }
  let ranking = newestJudgeRanking(repoRoot);
  if (ranking === null) {
    console.log("  no judge ranking found — running the judge first (one glm call)");
    const code = await runBacklogJudge({ cwd: repoRoot });
    if (code !== 0) {
      return { message: `judge failed (exit ${code}) — no ranking to pick from` };
    }
    ranking = newestJudgeRanking(repoRoot);
    if (ranking === null) {
      return { message: "judge wrote no readable cache — cannot pick" };
    }
  }
  // A stale cache may name already-drafted ideas: take the best OPEN id.
  const top = ranking.find((r) => openIds.has(r.id));
  if (top === undefined) {
    return { message: "every ranked idea is already drafted — harvest new ideas first" };
  }
  return { id: top.id, message: `judge rank ${top.rank}` };
}

// --- the verb -----------------------------------------------------------

interface StageResult {
  stage: string;
  code: number;
}

/** Exit-code runner for `video backlog auto`. */
export async function runBacklogAuto(opts: BacklogAutoOptions): Promise<number> {
  if (opts.installScheduler === true || opts.removeScheduler === true || opts.schedulerStatus === true) {
    return runBacklogSchedule({
      ...(opts.installScheduler === true ? { install: true } : {}),
      ...(opts.removeScheduler === true ? { remove: true } : {}),
      ...(opts.schedulerStatus === true ? { status: true } : {}),
      kind: "auto",
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts.plistDir !== undefined ? { plistDir: opts.plistDir } : {}),
      ...(opts.videoPath !== undefined ? { videoPath: opts.videoPath } : {}),
      ...(opts.runLaunchctl !== undefined ? { runLaunchctl: opts.runLaunchctl } : {}),
    });
  }

  const startedAt = Date.now();
  const repoRoot = findRepoRoot(opts.cwd ?? process.cwd());
  const minRemaining = opts.minRemaining ?? 80;
  const conditions: string[] = [];
  const refuse = async (reason: string, code = 0): Promise<number> => {
    conditions.push(reason);
    console.log(`✗ auto not firing: ${reason}`);
    await recordRun(repoRoot, "skipped", conditions, startedAt);
    return code;
  };

  let store;
  try {
    store = loadBacklogStore(repoRoot);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }

  // Quota: both Token Plan windows must hold the bar — a drained weekly
  // window must not be eaten by an afternoon burst.
  let quota: MiniMaxQuota;
  try {
    quota = await fetchMiniMaxQuota(opts.fetchImpl);
  } catch (err) {
    return refuse(`quota unavailable: ${(err as Error).message}`);
  }
  conditions.push(`quota: 5h ${quota.intervalRemaining}%, week ${quota.weeklyRemaining}% (bar ${minRemaining}%)`);
  if (quota.intervalRemaining < minRemaining || quota.weeklyRemaining < minRemaining) {
    return refuse(`MiniMax quota below ${minRemaining}%`);
  }

  // Idle: no minimax provider record, TTS audio or scene image in the window.
  const idleMinutes = minimaxIdleMinutes(repoRoot);
  const idleText = Number.isFinite(idleMinutes)
    ? `${Math.round(idleMinutes)} min`
    : ">24 h";
  conditions.push(`minimax idle: ${idleText}`);
  if (idleMinutes < IDLE_THRESHOLD_MIN) {
    return refuse(`MiniMax worked ${idleText} ago (< ${IDLE_THRESHOLD_MIN} min idle)`);
  }

  // One idea at a time: a stuck drafting entry is a resume, not a new pick.
  const stuck = store.ideas.filter((e) => e.status === "drafting");
  if (stuck.length > 0) {
    const names = stuck.map((e) => `${e.id}${isStaleDrafting(e) ? " (stale)" : ""}`).join(", ");
    return refuse(`idea(s) mid-pipeline: ${names} — resume manually or \`video backlog reset <id>\``);
  }

  const pick = await pickTopOpenId(repoRoot, store);
  if (pick.id === undefined) {
    return refuse(pick.message);
  }
  conditions.push(`pick: ${pick.id} (${pick.message})`);
  console.log(`✓ conditions met — top idea: ${pick.id}`);

  if (opts.dryRun === true) {
    console.log("! dry run — nothing executed, nothing written");
    await recordRun(repoRoot, "dry-run", conditions, startedAt);
    return 0;
  }

  const lock = acquireAutoLock(repoRoot);
  if (!lock.acquired) {
    return refuse(lock.reason);
  }

  const entry = store.ideas.find((e) => e.id === pick.id)!;
  // Auto-approve is THIS verb's decision, not the draft's: the pick flow
  // stamps drafting→drafted, but proposed→idea happens here so a mocked
  // or short-circuited draft still leaves an approved idea behind.
  if (entry.status === "proposed") {
    const approved = loadBacklogStore(repoRoot);
    const target = approved.ideas.find((e) => e.id === entry.id)!;
    assertTransition(target, "idea");
    target.status = "idea";
    saveBacklogStore(repoRoot, approved);
    conditions.push("auto-approved the proposed entry");
  }
  const slug = slugifyProjectName(entry.topic);
  const stages: StageResult[] = [];
  const fail = async (stage: string, code: number): Promise<number> => {
    stages.push({ stage, code });
    console.error(`✗ stage ${stage} failed (exit ${code}) — entry left in drafting; resume or \`video backlog reset ${entry.id}\``);
    await recordRun(repoRoot, "failed", [...conditions, `failed at ${stage} (exit ${code})`], startedAt, slug);
    releaseAutoLock(repoRoot);
    return code;
  };

  console.log(`▷ auto-producing ${entry.id} (project: ${slug}) zh + en-US`);

  const draftCode = await runDraftFromBacklog({
    id: entry.id,
    draft: { cwd: repoRoot, noAsk: true },
  });
  if (draftCode !== 0) return fail("draft-zh", draftCode);
  stages.push({ stage: "draft-zh", code: 0 });

  const makeZhCode = await runMakeCli({ project: slug, cwd: repoRoot });
  if (makeZhCode !== 0) return fail("make-zh", makeZhCode);
  stages.push({ stage: "make-zh", code: 0 });

  const translateCode = await runTranslate({
    project: slug,
    lang: "en-US",
    cwd: repoRoot,
  });
  if (translateCode !== 0) return fail("translate-en", translateCode);
  stages.push({ stage: "translate-en", code: 0 });

  const makeEnCode = await runMakeCli({
    project: slug,
    lang: "en-US",
    cwd: repoRoot,
  });
  if (makeEnCode !== 0) return fail("make-en", makeEnCode);
  stages.push({ stage: "make-en", code: 0 });

  await recordRun(repoRoot, "succeeded", [...conditions, ...stages.map((s) => s.stage)], startedAt, slug);
  releaseAutoLock(repoRoot);
  console.log(`✓ auto complete — ${slug}`);
  console.log(`  zh: projects/${slug}/output/final-mixed.mp4`);
  console.log(`  en: projects/${slug}/l10n/en-US/output/final-mixed.mp4`);
  console.log(`  upload stays manual (bilibili + zhihu convention)`);
  return 0;
}

/** RunRecord has no free-form field, so the evaluated conditions land in
 *  `error` — for a skipped run it IS the reason, for a success it is the
 *  stage trace. "skipped"/"dry-run" collapse onto "succeeded": the check
 *  itself completed; the decision lives in `error`. */
async function recordRun(
  repoRoot: string,
  status: "skipped" | "dry-run" | "failed" | "succeeded",
  conditions: string[],
  startedAt: number,
  slug?: string,
): Promise<void> {
  try {
    await writeRun(repoRoot, {
      run_id: formatRunId("backlog-auto"),
      stage: "backlog-auto",
      status: status === "failed" ? ("failed" as const) : ("succeeded" as const),
      actor: "agent" as const,
      tool: "video-backlog",
      input_commit: safeGitHead(repoRoot),
      input_files: ["backlog.yaml"],
      output_files:
        slug !== undefined && status === "succeeded"
          ? [`projects/${slug}/output/final-mixed.mp4`, `projects/${slug}/l10n/en-US/output/final-mixed.mp4`]
          : [],
      created_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      provider: "minimax+glm",
      model: "token-plan",
      ...(conditions.length > 0 ? { error: conditions.join(" | ") } : {}),
    });
  } catch {
    // A run-record write must never turn a skip into a crash.
  }
}

function safeGitHead(repoRoot: string): string {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

export function addAutoCommand(backlog: Command): void {
  backlog
    .command("auto")
    .description(
      "spare-capacity producer: when MiniMax is idle 1h and ≥80% quota remains, draft+render the judge's top idea in zh and en-US",
    )
    .option("--dry-run", "evaluate the trigger conditions and would-pick only — no pipeline, no store writes")
    .option(
      "--min-remaining <n>",
      "required remaining percent in both Token Plan windows (default 80)",
      (v) => parseInt(v, 10),
    )
    .option("--install-scheduler", "install the hourly launchd LaunchAgent for this check")
    .option("--remove-scheduler", "remove the hourly LaunchAgent")
    .option("--scheduler-status", "report the hourly LaunchAgent state")
    .option("--cwd <dir>", "repo root (default: walk up to pnpm-workspace.yaml)")
    .action(async (opts: {
      dryRun?: boolean;
      minRemaining?: number;
      installScheduler?: boolean;
      removeScheduler?: boolean;
      schedulerStatus?: boolean;
      cwd?: string;
    }) => {
      process.exitCode = await runBacklogAuto({
        ...(opts.dryRun === true ? { dryRun: true } : {}),
        ...(opts.minRemaining !== undefined ? { minRemaining: opts.minRemaining } : {}),
        ...(opts.installScheduler === true ? { installScheduler: true } : {}),
        ...(opts.removeScheduler === true ? { removeScheduler: true } : {}),
        ...(opts.schedulerStatus === true ? { schedulerStatus: true } : {}),
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      });
    });
}
