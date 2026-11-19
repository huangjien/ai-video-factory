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
  videoPath: string;
  programArgs: string[];
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
  const args = opts.programArgs
    .map((a) => `<string>${esc(a)}</string>`)
    .join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${esc(opts.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(opts.videoPath)}</string>
    ${args}
  </array>
  ${opts.triggerXml}
  <key>EnvironmentVariables</key>
  <dict>
    <key>VIDEO_ASK</key>
    <string>off</string>
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

export interface HarvestPlistOptions {
  videoPath: string;
  label?: string;
  logPath: string;
}

/** Pure plist text for the weekly LaunchAgent. Sunday 09:00 because the
 *  backlog refresh has no deadline pressure and early Sunday is when the
 *  machine is idle yet awake enough for an LLM run; weekly cadence matches
 *  the design doc (docs/plans/2026-11-18-backlog-feature-design.md §Scheduler). */
export function harvestPlistContent(opts: HarvestPlistOptions): string {
  const label = opts.label ?? DEFAULT_HARVEST_LABEL;
  return launchdPlist({
    label,
    videoPath: opts.videoPath,
    programArgs: ["backlog", "harvest"],
    triggerXml: `  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>0</integer>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>`,
    logPath: opts.logPath,
  });
}

export interface AutoPlistOptions {
  videoPath: string;
  label?: string;
  logPath: string;
}

/** Pure plist text for the auto-producer LaunchAgent. StartInterval 600:
 *  the trigger condition ("MiniMax idle an hour, ≥80% quota left") is
 *  cheap to evaluate and the pipeline itself refuses to double-run via
 *  its lockfile, so a 10-minute poke reacts fast to an idle gap without
 *  meaningful cost (2026-11-19: owner asked for 600 over 3600). */
export function autoPlistContent(opts: AutoPlistOptions): string {
  const label = opts.label ?? DEFAULT_AUTO_LABEL;
  return launchdPlist({
    label,
    videoPath: opts.videoPath,
    programArgs: ["backlog", "auto"],
    triggerXml: `  <key>StartInterval</key>
  <integer>600</integer>`,
    logPath: opts.logPath,
  });
}

export interface BacklogScheduleOptions {
  install?: boolean;
  remove?: boolean;
  status?: boolean;
  /** Which LaunchAgent to manage: weekly harvest (default) or the hourly
   *  auto-producer. */
  kind?: ScheduleKind;
  cwd?: string;
  /** TEST SEAM: overrides the LaunchAgents directory (default ~/Library/LaunchAgents). */
  plistDir?: string;
  /** TEST SEAM: overrides the resolved video binary path, skipping which/bin lookup.
   *  Empty string simulates total resolution failure (real `which video` may succeed
   *  on dev machines, so there is no other way to exercise the failure branch). */
  videoPath?: string;
  /** TEST SEAM: replaces launchctl execution; receives the argv after "launchctl". */
  runLaunchctl?: (args: string[]) => Promise<number>;
}

function defaultRunLaunchctl(args: string[]): Promise<number> {
  const r = spawnSync("launchctl", args, { encoding: "utf8" });
  return Promise.resolve(r.status ?? 1);
}

function whichVideo(): string | null {
  try {
    const out = execFileSync("which", ["video"], { encoding: "utf8" }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function resolveVideoBinary(opts: BacklogScheduleOptions): string | null {
  if (opts.videoPath !== undefined) return opts.videoPath.length > 0 ? opts.videoPath : null;
  const fromPath = whichVideo();
  if (fromPath !== null) return fromPath;
  const fallback = path.join(findRepoRoot(opts.cwd ?? process.cwd()), "bin", "video");
  return existsSync(fallback) ? fallback : null;
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

async function doInstall(opts: BacklogScheduleOptions): Promise<number> {
  const video = resolveVideoBinary(opts);
  if (video === null) {
    console.error(
      "video binary not found — symlink bin/video into PATH (see repo docs), or pass --video-path",
    );
    return 1;
  }
  const kind = plistKind(opts);
  const target = plistPath(opts);
  mkdirSync(path.dirname(target), { recursive: true });
  const content =
    kind === "auto"
      ? autoPlistContent({ videoPath: video, logPath: defaultLogPath(opts) })
      : harvestPlistContent({ videoPath: video, logPath: defaultLogPath(opts) });
  writeFileSync(target, content, { mode: 0o644 });
  const run = opts.runLaunchctl ?? defaultRunLaunchctl;
  const code = await run(["load", target]);
  if (code !== 0) {
    console.error(`launchctl load failed (exit ${code}). Load manually with:\n  launchctl load "${target}"`);
    return 1;
  }
  const cadence = kind === "auto" ? "auto-producer (every 10 min)" : "weekly backlog harvest";
  console.log(`installed ${labelOf(kind)} — ${cadence}, plist at ${target}`);
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
