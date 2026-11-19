import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { findRepoRoot } from "./learn-command.js";

export const DEFAULT_HARVEST_LABEL = "com.aivideofactory.backlog-harvest";
export const DEFAULT_AUTO_LABEL = "com.aivideofactory.backlog-auto";

export type ScheduleKind = "harvest" | "auto";

/** Shared LaunchAgent skeleton; the two kinds differ only in label,
 *  program args and the trigger block. */
function launchdPlist(opts: {
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  workingDir: string;
  triggerXml: string;
  logPath: string;
}): string {
  // XML-escape only what can realistically contain & < > ' here: user paths.
  const esc = (s: string): string =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("'", "&apos;");
  const argv = [opts.command, ...opts.args]
    .map((a) => `<string>${esc(a)}</string>`)
    .join("\n    ");
  const envXml = Object.entries(opts.env)
    .map(([k, v]) => `    <key>${esc(k)}</key>\n    <string>${esc(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${esc(opts.label)}</string>
  <key>ProgramArguments</key>
  <array>
    ${argv}
  </array>
  ${opts.triggerXml}
  <key>WorkingDirectory</key>
  <string>${esc(opts.workingDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>StandardOutPath</key>
  <string>${esc(opts.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${esc(opts.logPath)}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
}

export interface PlistContentOptions {
  /** Absolute executable — launchd has no shell PATH, so "video" alone
   *  fails with exit 127 (measured 2026-11-19). Pass the absolute node
   *  binary + dist entry via args. */
  command: string;
  args: string[];
  label?: string;
  logPath: string;
  /** WorkingDirectory — launchd defaults to /, and findRepoRoot walks UP
   *  from there, so the store/projects are invisible without this
   *  (measured 2026-11-19: "no open entries" from a 73-entry backlog). */
  workingDir?: string;
  /** PATH for the run's children — make spawns ffmpeg/remotion from
   *  Homebrew paths launchd does not set. */
  envPath?: string;
  /** Provider keys and overrides copied into EnvironmentVariables —
   *  launchd inherits NO shell env, so without these the quota check and
   *  every provider call fail (measured 2026-11-19). */
  env?: Record<string, string>;
}

const TRIGGER_HARVEST = `  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>0</integer>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>`;

const TRIGGER_AUTO = `  <key>StartInterval</key>
  <integer>600</integer>`;

/** LaunchAgent plist for a schedule kind. Weekly harvest (Sunday 09:00 —
 *  no deadline pressure) or the auto-producer (StartInterval 600 — the
 *  trigger is cheap and the lockfile prevents double-runs; 2026-11-19:
 *  owner asked for 600 over 3600). */
export function plistContentFor(
  kind: ScheduleKind,
  opts: PlistContentOptions,
): string {
  const label = opts.label ?? labelOf(kind);
  return launchdPlist({
    label,
    command: opts.command,
    args: opts.args,
    workingDir: opts.workingDir ?? process.cwd(),
    env: {
      VIDEO_ASK: "off",
      PATH:
        opts.envPath ??
        "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      ...(opts.env ?? {}),
    },
    triggerXml: kind === "auto" ? TRIGGER_AUTO : TRIGGER_HARVEST,
    logPath: opts.logPath,
  });
}

export interface BacklogScheduleOptions {
  install?: boolean;
  remove?: boolean;
  status?: boolean;
  /** Which LaunchAgent to manage: weekly harvest (default) or the 10-min
   *  auto-producer. */
  kind?: ScheduleKind;
  cwd?: string;
  /** TEST SEAM: overrides the LaunchAgents directory (default ~/Library/LaunchAgents). */
  plistDir?: string;
  /** TEST SEAM: overrides the built CLI entry the plist runs. Default
   *  <repo>/packages/cli/dist/index.js; a nonexistent path simulates the
   *  missing-build failure (the plist cannot fall back to the `video`
   *  wrapper — launchd has no shell PATH, exit 127 measured 2026-11-19). */
  distEntry?: string;
  /** TEST SEAM: overrides the node binary for ProgramArguments. */
  command?: string;
  /** TEST SEAM: replaces launchctl execution; receives the argv after "launchctl". */
  runLaunchctl?: (args: string[]) => Promise<number>;
}

function defaultRunLaunchctl(args: string[]): Promise<number> {
  const r = spawnSync("launchctl", args, { encoding: "utf8" });
  return Promise.resolve(r.status ?? 1);
}

function resolveDistEntry(opts: BacklogScheduleOptions): string | null {
  if (opts.distEntry !== undefined) {
    return existsSync(opts.distEntry) ? opts.distEntry : null;
  }
  const fallback = path.join(
    findRepoRoot(opts.cwd ?? process.cwd()),
    "packages",
    "cli",
    "dist",
    "index.js",
  );
  return existsSync(fallback) ? fallback : null;
}

/** The PATH launchd children get: node's own dir plus the usual Homebrew
 *  / system dirs — make spawns ffmpeg and Remotion from those. */
function launchdEnvPath(): string {
  const nodeDir = path.dirname(process.execPath);
  return `${nodeDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
}

function plistDir(opts: BacklogScheduleOptions): string {
  return opts.plistDir ?? path.join(homedir(), "Library", "LaunchAgents");
}

function plistKind(opts: BacklogScheduleOptions): ScheduleKind {
  return opts.kind ?? "harvest";
}

function labelOf(kind: ScheduleKind): string {
  return kind === "auto" ? DEFAULT_AUTO_LABEL : DEFAULT_HARVEST_LABEL;
}

function plistPath(opts: BacklogScheduleOptions): string {
  return path.join(plistDir(opts), `${labelOf(plistKind(opts))}.plist`);
}

function defaultLogPath(opts: BacklogScheduleOptions): string {
  const kind = plistKind(opts);
  const stamp = new Date().toISOString().slice(0, 10);
  return path.join(
    findRepoRoot(opts.cwd ?? process.cwd()),
    "runs",
    `backlog-${kind}-${stamp}.yaml`,
  );
}

/** Loaded-detection differs by seam: the real `launchctl list` exits 0 even
 *  when the label is absent, so its stdout must be scanned; a test seam only
 *  exposes a code, so non-zero means "not loaded" there. */
async function isLoaded(
  label: string,
  opts: BacklogScheduleOptions,
): Promise<boolean> {
  if (opts.runLaunchctl !== undefined) {
    return (await opts.runLaunchctl(["list"])) === 0;
  }
  try {
    const out = execFileSync("launchctl", ["list"], { encoding: "utf8" });
    return out.split("\n").some((line) => line.includes(label));
  } catch {
    return false;
  }
}

/** Provider keys and overrides the pipeline reads from env. At install
 *  time, whichever exist in the INSTALLING shell are baked into the plist
 *  — launchd inherits no shell env. */
const ENV_KEYS = [
  "MINIMAX_API_KEY",
  "GLM_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GLM_BASE_URL",
  "MINIMAX_API_HOST",
  "OPENAI_API_BASE_URL",
  "GEMINI_API_BASE_URL",
  "LL_CONFIG",
] as const;

async function doInstall(opts: BacklogScheduleOptions): Promise<number> {
  const dist = resolveDistEntry(opts);
  if (dist === null) {
    console.error(
      `built CLI entry not found (${path.join("packages", "cli", "dist", "index.js")}) — run \`pnpm build\` first, then reinstall`,
    );
    return 1;
  }
  const kind = plistKind(opts);
  const target = plistPath(opts);
  mkdirSync(path.dirname(target), { recursive: true });
  const env: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined && value !== "") env[key] = value;
  }
  const embedded = Object.keys(env);
  const content = plistContentFor(kind, {
    command: opts.command ?? process.execPath,
    args: [dist, "backlog", kind],
    workingDir: findRepoRoot(opts.cwd ?? process.cwd()),
    envPath: launchdEnvPath(),
    logPath: defaultLogPath(opts),
    env,
  });
  // The plist carries provider keys — user-only read/write.
  writeFileSync(target, content, { mode: 0o600 });
  const run = opts.runLaunchctl ?? defaultRunLaunchctl;
  const code = await run(["load", target]);
  if (code !== 0) {
    console.error(`launchctl load failed (exit ${code}). Load manually with:\n  launchctl load "${target}"`);
    return 1;
  }
  const cadence = kind === "auto" ? "auto-producer (every 10 min)" : "weekly backlog harvest";
  console.log(`installed ${labelOf(kind)} — ${cadence}, plist at ${target}`);
  console.log(`  env baked in: ${embedded.length > 0 ? embedded.join(", ") : "(none found — provider calls will fail until keys are present at install time)"}`);
  return 0;
}

async function doRemove(opts: BacklogScheduleOptions): Promise<number> {
  const target = plistPath(opts);
  if (!existsSync(target)) {
    console.log(`no schedule installed (missing ${target}) — nothing to remove`);
    return 0;
  }
  const run = opts.runLaunchctl ?? defaultRunLaunchctl;
  await run(["unload", target]);
  rmSync(target, { force: true });
  console.log(`removed ${labelOf(plistKind(opts))} (${target})`);
  return 0;
}

async function doStatus(opts: BacklogScheduleOptions): Promise<number> {
  const label = labelOf(plistKind(opts));
  const target = plistPath(opts);
  const installed = existsSync(target);
  console.log(`plist: ${installed ? "installed" : "not installed"} (${target})`);
  if (installed) {
    const loaded = await isLoaded(label, opts);
    console.log(`loaded: ${loaded ? "yes" : "no"}`);
  }
  return 0;
}

/** Exit-code runner for `video backlog schedule`. Exactly one of
 *  --install/--remove/--status must be given, else usage error (exit 1). */
export async function runBacklogSchedule(opts: BacklogScheduleOptions): Promise<number> {
  const chosen = [opts.install === true, opts.remove === true, opts.status === true].filter(Boolean).length;
  if (chosen !== 1) {
    console.error("usage: video backlog schedule --install | --remove | --status (exactly one)");
    return 1;
  }
  if (opts.install === true) return doInstall(opts);
  if (opts.remove === true) return doRemove(opts);
  return doStatus(opts);
}

export function addScheduleCommand(backlog: Command): void {
  backlog
    .command("schedule")
    .description("manage launchd LaunchAgents: weekly harvest (default) or the 10-minute auto-producer (--kind auto)")
    .option("--install", "write the plist and launchctl load it")
    .option("--remove", "launchctl unload and delete the plist")
    .option("--status", "report install/load state")
    .option("--kind <kind>", "which agent: harvest (default) | auto")
    .option("--cwd <dir>", "repo root (default: walk up to pnpm-workspace.yaml)")
    .action(async (opts: { install?: boolean; remove?: boolean; status?: boolean; kind?: string; cwd?: string }) => {
      process.exitCode = await runBacklogSchedule({
        ...(opts.install === true ? { install: true } : {}),
        ...(opts.remove === true ? { remove: true } : {}),
        ...(opts.status === true ? { status: true } : {}),
        ...(opts.kind === "auto" ? { kind: "auto" as const } : {}),
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      });
    });
}
