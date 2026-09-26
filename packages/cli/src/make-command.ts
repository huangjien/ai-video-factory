import path from "node:path";
import { runMake } from "@vf/make";
import { resolveProjectDir } from "./project-path.js";

export interface MakeOptions {
  project: string;
  cwd?: string;
  fake?: boolean;
  dryRun?: boolean;
  /** Image provider for scene visuals: minimax (real AI), mock, or none. */
  imageProvider?: "minimax" | "mock" | "none";
  /** Local music library dir — BGM tags resolve to {tag}.wav inside it. */
  bgmDir?: string;
  /** Local SFX library dir — same lookup rule as bgmDir. */
  sfxDir?: string;
}

export async function runMakeCli(opts: MakeOptions): Promise<number> {
  const resolvedProject = resolveProjectDir(opts.project, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    return 1;
  }
  const projectRoot = resolvedProject.root;

  const report = await runMake({
    projectRoot,
    ...(opts.fake !== undefined ? { fake: opts.fake } : {}),
    ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
    ...(opts.imageProvider !== undefined
      ? { imageProvider: opts.imageProvider }
      : {}),
    ...(opts.bgmDir !== undefined ? { bgmDir: opts.bgmDir } : {}),
    ...(opts.sfxDir !== undefined ? { sfxDir: opts.sfxDir } : {}),
  });

  // Pretty-print the report.
  for (const s of report.steps) {
    const tag = s.status === "ran" ? "✓" : s.status === "skip" ? "⏭" : s.status === "would-run" ? "?" : "✗";
    const line = `  ${tag} ${s.name}` + (s.message ? `: ${s.message}` : "");
    console.log(line);
    for (const o of s.outputs ?? []) console.log(`      ${o}`);
  }
  const failed = report.steps.filter((s) => s.status === "fail");
  if (failed.length > 0) {
    console.error(
      `\nmake: ${failed.length} step(s) failed — fix and re-run \`vf make ${opts.project}\``,
    );
    return 1;
  }
  console.log(`\nmake: done`);
  return 0;
}
