import { execSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Command } from "commander";
import { formatRunId, writeRun, approveCheckpoint } from "@video/workflow";
import { findRepoRoot } from "./learn-command.js";
import { slugifyProjectName } from "./project-path.js";
import { l10nRootOrThrow } from "./translate-command.js";
import { runBilibili } from "./bilibili-command.js";
import { runYouTube } from "./youtube-command.js";
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
 * the next idea. Designed to be poked every 10 minutes by launchd
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
  /** TEST SEAM: replaces the publish steps (bilibili/YouTube uploads).
   *  Default uploads for real. Returns the stage exit code. */
  runPublish?: (step: PublishStep) => Promise<number>;
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
    // The auto verb's own bookkeeping records carry provider "minimax+glm"
    // but spend nothing themselves — counting them here meant every 10-min
    // tick re-blocked on the previous tick's skip record, forever.
    if (/^\s*stage:\s*backlog-auto/m.test(text)) return false;
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

// --- publishing ---------------------------------------------------------

export type PublishStepKind = "bili-zh" | "yt-zh" | "yt-en" | "bili-en";

export interface PublishStep {
  kind: PublishStepKind;
  slug: string;
  repoRoot: string;
  anchors: string[];
}

const BILI_UPLOAD_PY = path.join(homedir(), ".venvs", "biliup", "bin", "python");

function spawnUpload(args: string[], cwd: string): Promise<{ code: number; output: string }> {
  // Promise.withResolvers would be cleaner but the package's TS lib target
  // predates es2024.
  return new Promise((resolve) => {
    const child = spawn(BILI_UPLOAD_PY, [path.join(cwd, "scripts", "bilibili-upload.py"), ...args], {
      cwd,
      env: process.env,
    });
    let output = "";
    child.stdout.on("data", (d: Buffer) => {
      output += d.toString();
      process.stdout.write(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      output += d.toString();
      process.stderr.write(d);
    });
    child.on("error", (err) => {
      output += String(err);
      resolve({ code: 1, output });
    });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

/** The real publish step. YouTube stays PRIVATE: testing-mode OAuth apps
 *  lock uploads private anyway, and going public stays a human call in
 *  Studio. bilibili is the channel's public surface, matching every
 *  manual publish so far. */
async function defaultPublish(step: PublishStep): Promise<number> {
  if (step.kind === "yt-zh" || step.kind === "yt-en") {
    const projectArg =
      step.kind === "yt-en"
        ? path.join("projects", step.slug, "l10n", "en-US")
        : step.slug;
    return runYouTube({
      project: projectArg,
      cwd: step.repoRoot,
      upload: true,
      privacy: "private",
      thumbnailProvider: "minimax",
    });
  }
  if (step.kind === "bili-zh") {
    const pkg = await runBilibili({ project: step.slug, cwd: step.repoRoot });
    if (pkg !== 0) return pkg;
    const up = await spawnUpload([step.slug], step.repoRoot);
    return up.code;
  }
  // bili-en: standalone — no bilibili/package.yaml exists for the l10n
  // workdir, so the metadata comes from the en YouTube package.
  const ytPkgPath = path.join(
    step.repoRoot,
    "projects",
    step.slug,
    "l10n",
    "en-US",
    "youtube",
    "package.yaml",
  );
  if (!existsSync(ytPkgPath)) {
    console.error(`  ! missing ${ytPkgPath} — run the yt-en publish first`);
    return 1;
  }
  const meta = parseYaml(readFileSync(ytPkgPath, "utf8")) as {
    title?: string;
    description?: string;
  };
  const tags =
    step.anchors.length > 0
      ? [...step.anchors, "Chinese history", "documentary"].join(",")
      : "Chinese history,Tang Dynasty,documentary";
  const up = await spawnUpload(
    [
      "--standalone",
      "--video",
      path.join("projects", step.slug, "l10n", "en-US", "output", "final-mixed.mp4"),
      "--title",
      meta.title ?? step.slug,
      "--desc",
      (meta.description ?? "").slice(0, 900),
      "--tag",
      tags,
      "--tid",
      "202",
      "--cover",
      path.join("projects", step.slug, "l10n", "en-US", "youtube", "thumbnail.jpg"),
    ],
    step.repoRoot,
  );
  if (up.code !== 0) return up.code;
  // Record the BV id the same way the zh project upload does — stats'
  // published tier reads it.
  const bv = up.output.match(/BV[0-9A-Za-z]{10}/)?.[0];
  if (bv !== undefined) {
    const dir = path.join(step.repoRoot, "projects", step.slug, "l10n", "en-US", "bilibili");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "bvid.txt"), bv + "\n", "utf8");
  }
  return 0;
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
  const publishFailures: string[] = [];
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

  // make's render step gates on an approved storyboard (measured
  // 2026-11-19: render-preview refused without it). The gate exists so a
  // human reads the storyboard — the auto run reads it by construction:
  // the article was just judged ≥90 by the cross-model review loop.
  const zhRoot = path.join(repoRoot, "projects", slug);
  const approveZh = await approveCheckpoint(zhRoot, { stage: "storyboard" });
  if (!approveZh.ok) return fail("approve-storyboard-zh", 1);
  stages.push({ stage: "approve-storyboard-zh", code: 0 });

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

  const enRoot = l10nRootOrThrow(zhRoot, "en-US");
  const approveEn = await approveCheckpoint(enRoot, { stage: "storyboard" });
  if (!approveEn.ok) return fail("approve-storyboard-en", 1);
  stages.push({ stage: "approve-storyboard-en", code: 0 });

  const makeEnCode = await runMakeCli({
    project: slug,
    lang: "en-US",
    cwd: repoRoot,
  });
  if (makeEnCode !== 0) return fail("make-en", makeEnCode);
  stages.push({ stage: "make-en", code: 0 });

  // Publishing (owner mandate 2026-11-19: upload without waiting): zh
  // bilibili (public) + zh YouTube (private) + en YouTube (private) +
  // en bilibili standalone (public). A publish failure is NON-fatal —
  // the MP4s exist; the upload can be retried by hand.
  const anchors = entry.anchors ?? [];
  for (const kind of ["bili-zh", "yt-zh", "yt-en", "bili-en"] as const) {
    const code = await (opts.runPublish ?? defaultPublish)(
      { kind, slug, repoRoot, anchors },
    );
    stages.push({ stage: `publish-${kind}`, code });
    if (code !== 0) {
      publishFailures.push(`publish-${kind}`);
      console.error(
        `  ! publish-${kind} failed (exit ${code}) — non-fatal: the MP4s are produced, retry the upload by hand`,
      );
    }
  }
  if (publishFailures.length === 0) {
    console.log("✓ published: bilibili zh+en (public), YouTube zh+en (private)");
  }
  console.log(
    `  ! zhihu has no upload API — create the manual post at zhihu.com 创作中心 with bilibili/package.yaml title/desc/tags + the zh MP4`,
  );

  await recordRun(
    repoRoot,
    "succeeded",
    [
      ...conditions,
      ...stages.map((s) => s.stage),
      ...publishFailures.map((f) => `publish failed (non-fatal): ${f}`),
    ],
    startedAt,
    slug,
  );
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
    .option("--install-scheduler", "install the 10-minute launchd LaunchAgent for this check")
    .option("--remove-scheduler", "remove the 10-minute LaunchAgent")
    .option("--scheduler-status", "report the 10-minute LaunchAgent state")
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
