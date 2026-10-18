import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { loadCheckpoint, readProjectState, V01_STAGES } from "@video/workflow";
import { resolveProjectDir, resolveProjectRoot } from "./project-path.js";
import {
  MARK_FAIL,
  MARK_NOW,
  MARK_OK,
  MARK_TODO,
  MARK_WARN,
  brandBannerLine,
  channelHeader,
} from "./ui.js";

const STAGE_MARK: Record<string, string> = {
  approved: MARK_OK,
  rejected: MARK_FAIL,
  invalidated: MARK_FAIL,
  in_progress: MARK_NOW,
};

export async function runStatus(
  projectName?: string,
  cwd?: string,
): Promise<number> {
  let root: string;
  if (projectName) {
    const resolved = resolveProjectDir(projectName, cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return 1;
    }
    root = resolved.root;
  } else {
    const resolved = resolveProjectRoot(cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return 1;
    }
    root = resolved.root;
  }
  const state = await readProjectState(root);
  if (!state) return 1;

  // Channel-home header: operator sees project + current checkpoint at a
  // glance, then a vertical timeline, then a QA footer.
  console.log(brandBannerLine());
  console.log(channelHeader(path.basename(root), state.checkpoint.id));
  console.log("");
  console.log("Pipeline");
  console.log("────────");
  for (const stage of V01_STAGES) {
    const cp = await loadCheckpoint(root, stage);
    let mark = MARK_TODO;
    if (cp) {
      const key =
        cp.status === "approved" ||
        cp.status === "rejected" ||
        cp.status === "invalidated"
          ? cp.status
          : "in_progress";
      mark = STAGE_MARK[key] ?? MARK_TODO;
    }
    const isCurrent = state.current_stage === stage;
    const indicator = isCurrent ? "▷" : " ";
    console.log(`${indicator} ${mark} ${stage}`);
  }
  console.log("");
  console.log(`Status: ${state.status}`);

  // v0.4 (T7): surface the latest QA finding count so users see what's
  // blocking `video final` without manually running `video qa`. We read
  // qa/render-report.json (the on-disk artifact written by `video final` /
  // `video preview`); fall back to the latest qa run record when the JSON
  // file is missing.
  const reportPath = path.join(root, "qa", "render-report.json");
  if (existsSync(reportPath)) {
    try {
      const raw = readFileSync(reportPath, "utf8");
      const parsed = parseYaml(raw) as {
        findings?: { level?: string }[];
        ok?: boolean;
      };
      const findings = parsed.findings ?? [];
      const errors = findings.filter((f) => f.level === "error").length;
      const warnings = findings.filter((f) => f.level === "warn").length;
      const errMark = errors > 0 ? MARK_FAIL : MARK_OK;
      const warnMark = warnings > 0 ? MARK_WARN : MARK_OK;
      console.log(
        `QA: ${errMark} ${errors} error${errors === 1 ? "" : "s"}, ${warnMark} ${warnings} warning${warnings === 1 ? "" : "s"}`,
      );
      if (errors > 0) {
        console.log(`  run \`video qa <project>\` to inspect, or \`video final --force\` to override`);
      }
    } catch (err) {
      // A corrupt report used to print NOTHING — while `video final` still
      // gates on this same file. Name the problem and the fix instead.
      console.log(
        `QA: ⚠ report unreadable (${(err as Error).message.slice(0, 80)}) — run \`video qa ${path.basename(root)}\``,
      );
    }
  }
  return 0;
}

export function registerStatus(program: Command): void {
program
  .command("status")
  .argument("[project]", "project name (slug) — optional")
  .option("--cwd <dir>", "project root")
  .action(async (project: string | undefined, opts: { cwd?: string }) => {
    process.exitCode = await runStatus(project, opts.cwd);
  });
}
