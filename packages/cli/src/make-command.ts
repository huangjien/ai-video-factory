import path from "node:path";
import { existsSync } from "node:fs";
import { runMake } from "@vf/make";
import { slugifyForProject } from "./project-path.js";

export interface MakeOptions {
  project: string;
  cwd?: string;
  /** Use offline fake TTS provider (no Edge-TTS network call). */
  fake?: boolean;
  dryRun?: boolean;
}

export async function runMakeCli(opts: MakeOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const projectId = slugifyForProject(opts.project);
  const projectRoot = path.join(cwd, "projects", projectId);

  if (!existsSync(projectRoot)) {
    console.error(`project not found: ${projectRoot}`);
    return 1;
  }

  const report = await runMake({
    projectRoot,
    ...(opts.fake !== undefined ? { fake: opts.fake } : {}),
    ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
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
