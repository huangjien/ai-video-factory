import { existsSync } from "node:fs";
import path from "node:path";
import { writeQaArtifacts } from "@video/qa";
import { resolveProjectDir, resolveProjectRoot } from "./project-path.js";
import { loadOrCompileStoryboard } from "./render-command.js";
import {
  MARK_FAIL,
  MARK_OK,
  brandBannerLine,
  channelHeader,
} from "./ui.js";

export interface QaOptions {
  project?: string | undefined;
  cwd?: string | undefined;
  /** Exit non-zero on error-level findings (default true — this is the
   * gate surface T6.2 wires into the export path). */
  strict?: boolean | undefined;
}

/** Standalone QA run (plan T6.1): rebuild the report for the current
 * preview artifact and print the findings. `--strict` (default) exits 1
 * on error-level findings so CI/pipelines can gate on it. */
export async function runQa(opts: QaOptions): Promise<number> {
  let root: string;
  if (opts.project) {
    const resolved = resolveProjectDir(opts.project, opts.cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return 1;
    }
    root = resolved.root;
  } else {
    const resolved = resolveProjectRoot(opts.cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return 1;
    }
    root = resolved.root;
  }
  const video = path.join(root, "output", "preview.mp4");
  if (!existsSync(video)) {
    console.error(
      `qa: no preview at ${video} — run \`video preview\` first (QA reports always analyze a real render)`,
    );
    return 1;
  }

  const { renderPlan } = await loadOrCompileStoryboard(root);
  const report = await writeQaArtifacts(root, renderPlan, video);
  const errors = report.findings.filter((f) => f.level === "error");
  const warns = report.findings.filter((f) => f.level === "warn");

  console.log(brandBannerLine());
  console.log(
    channelHeader(path.basename(root), report.ok ? `qa · ok · ${errors.length} err / ${warns.length} warn` : `qa · failed · ${errors.length} err / ${warns.length} warn`),
  );
  console.log("");
  console.log(
    `Preview: ${path.basename(video)}`,
  );
  console.log("");
  if (report.findings.length === 0) {
    console.log(`  ${MARK_OK} no findings`);
  } else {
    for (const f of report.findings) {
      const tag = f.level === "error" ? MARK_FAIL : "!";
      console.log(`  ${tag} [${f.level}] ${f.check}: ${f.message}`);
      if (f.fix) console.log(`         fix: ${f.fix}`);
    }
  }
  console.log("");
  console.log(
    `  details: qa/render-report.json + qa/contact-sheet.png`,
  );

  const strict = opts.strict !== false;
  if (strict && !report.ok) {
    console.error(`qa: error-level findings present (strict mode)`);
    return 1;
  }
  return 0;
}
