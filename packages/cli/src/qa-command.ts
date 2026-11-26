import type { Command } from "commander";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  captionOverlapScenes,
  decisionLogPath,
  runCaptionOverlapShadow,
  runQaDecisionAdvisory,
  writeQaAdvisoryReport,
  writeQaArtifacts,
} from "@video/qa";
import { resolveDecisionMode } from "@video/llm";
import { resolveProjectDir, resolveProjectRoot } from "./project-path.js";
import { loadOrCompileStoryboard } from "@video/video-renderer";
import { MARK_FAIL, MARK_OK, brandBannerLine, channelHeader } from "./ui.js";

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
  let report = await writeQaArtifacts(root, renderPlan, video);

  // v0.11 (D3): the QA triage advisory. One consult per finding, on the
  // report AS WRITTEN; the advisory fields are attached by re-writing
  // the report, and the consults land in <root>/decision-log.jsonl.
  // Advisory never gates — `--strict` reads `level` below. The layer is
  // off by default (2026-11-26: it records and nothing acts), so the
  // consult is skipped unless DECISION_MODE says otherwise.
  const decisionMode = resolveDecisionMode();
  const advisory = await runQaDecisionAdvisory({
    project: path.basename(root),
    report,
    mode: decisionMode,
    logPath: decisionLogPath(root),
  });
  report = advisory.report;
  if (advisory.consulted > 0) {
    await writeQaAdvisoryReport(
      path.join(root, "qa", "render-report.json"),
      report,
    );
  }

  // v0.12 (P2): the caption-overlap shadow pass. One consult per
  // captioned frame — the deterministic caption check knows where the
  // caption sits and cannot see what else is drawn in the same band.
  // The answer lands in the decision log; the report is NOT rewritten
  // and nothing gates.
  const captionShadow = await runCaptionOverlapShadow({
    project: path.basename(root),
    scenes: captionOverlapScenes(renderPlan),
    mode: decisionMode,
    logPath: decisionLogPath(root),
  });

  const errors = report.findings.filter(
    (f: { level: string }) => f.level === "error",
  );
  const warns = report.findings.filter(
    (f: { level: string }) => f.level === "warn",
  );

  console.log(brandBannerLine());
  console.log(
    channelHeader(
      path.basename(root),
      report.ok
        ? `qa · ok · ${errors.length} err / ${warns.length} warn`
        : `qa · failed · ${errors.length} err / ${warns.length} warn`,
    ),
  );
  console.log("");
  console.log(`Preview: ${path.basename(video)}`);
  console.log("");
  if (report.findings.length === 0) {
    console.log(`  ${MARK_OK} no findings`);
  } else {
    for (const f of report.findings) {
      const tag = f.level === "error" ? MARK_FAIL : "!";
      console.log(`  ${tag} [${f.level}] ${f.check}: ${f.message}`);
      if (f.fix) console.log(`         fix: ${f.fix}`);
      if (f.advisory) {
        console.log(
          `         ↳ decision advisory: ${f.advisory} (${f.advisory_confidence?.toFixed(2) ?? "?"})`,
        );
      }
    }
  }
  console.log("");
  if (advisory.consulted > 0) {
    console.log(
      `  decision advisory: ${advisory.consulted} finding(s) consulted, ${advisory.agreed} agreed with the level rule`,
    );
    console.log("");
  }
  if (captionShadow.consulted > 0) {
    console.log(
      `  decision shadow (captions): ${captionShadow.consulted} frame(s) consulted, ${captionShadow.agreed} agreed with the caption check`,
    );
    console.log("");
  }
  console.log(`  details: qa/render-report.json + qa/contact-sheet.png`);

  const strict = opts.strict !== false;
  if (strict && !report.ok) {
    console.error(`qa: error-level findings present (strict mode)`);
    return 1;
  }
  return 0;
}

export function registerQa(program: Command): void {
  program
    .command("qa")
    .description(
      "QA Agent: rebuild the render report for the current preview (plan §28/T6.1); exits 1 on error-level findings",
    )
    .argument(
      "[project]",
      "project name (slug) — optional if exactly one project exists",
    )
    .option("--cwd <dir>", "project root base directory")
    .option("--no-strict", "report findings without failing the command")
    .action(
      async (
        project: string | undefined,
        opts: { cwd?: string; strict?: boolean },
      ) => {
        process.exitCode = await runQa({
          ...(project !== undefined ? { project } : {}),
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          strict: opts.strict !== false,
        });
      },
    );
}
