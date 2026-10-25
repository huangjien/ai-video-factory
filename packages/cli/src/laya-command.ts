import type { Command } from "commander";
import {
  LayaClient,
  readLayaDecisions,
  resolveLayaConfig,
  summarizeAgreement,
  type LayaMode,
  type LayaQuestion,
} from "@video/llm";
import { resolveProjectDir } from "./project-path.js";

/**
 * v0.6 (L2) — `video laya` diagnostics for the local decision-model
 * sidecar (docs/v0.6-laya-decision-integration-plan.md).
 *
 *   video laya health            live /health probe + resolved config
 *   video laya ask --file f.json one bounded-decision consult ({state, questions})
 *   video laya eval <project>    §7 shadow-agreement table from the project's
 *                                laya-decisions.jsonl (promotion gates)
 *
 * Diagnostics only — no pipeline behavior is changed by this verb.
 */

const SIDECAR_NAME = "laya-decisions.jsonl";

/** §7 promotion gates (threshold + what the metric means). */
const GATES: readonly { surface: string; threshold: number }[] = [
  { surface: "motion", threshold: 90 },
  { surface: "visual", threshold: 85 },
  { surface: "triage", threshold: 95 },
  // The severity surface grades a finding's severity on a 0-100 scale,
  // and the baseline is today's hand-picked level mapped onto that
  // scale. A HIGH bar: a score surface can only RAISE a level, so a
  // disagreement costs a false promotion, not a missed defect. The gate
  // stays strict until the score tracks the human call closely.
  { surface: "severity", threshold: 90 },
];

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export interface LayaOptions {
  cwd?: string | undefined;
}

export async function runLayaHealth(opts: LayaOptions): Promise<number> {
  const cfg = resolveLayaConfig();
  console.log(
    `laya: ${cfg.url} (mode=${cfg.mode}, min_confidence=${cfg.minConfidence}, timeout=${cfg.timeoutMs}ms)`,
  );
  const client = new LayaClient({ resolvedConfig: cfg });
  const health = await client.health(true);
  if (health === null) {
    console.error("✗ laya: service unreachable or unhealthy");
    console.error(
      "  start it: launchctl load ~/Library/LaunchAgents/com.local.laya.plist",
    );
    return 1;
  }
  console.log(`✓ status=${health.status} device=${health.device}`);
  console.log(`  loaded: ${health.loaded.join(", ")}`);
  for (const [name, rev] of Object.entries(health.revisions ?? {})) {
    console.log(`  ${name}: ${String(rev).slice(0, 12)}`);
  }
  return 0;
}

export async function runLayaAsk(
  file: string | undefined,
  opts: LayaOptions,
): Promise<number> {
  void opts;
  const raw = file
    ? (await import("node:fs/promises")).readFile(file, "utf8")
    : await readStdin();
  let body: { state?: unknown; questions?: unknown };
  try {
    body = JSON.parse(await raw) as typeof body;
  } catch (err) {
    console.error(
      `laya ask: input is not valid JSON: ${(err as Error).message}`,
    );
    return 1;
  }
  if (
    typeof body.state !== "string" ||
    typeof body.questions !== "object" ||
    body.questions === null
  ) {
    console.error(
      'laya ask: input must be {"state": string, "questions": {<id>: {type, instructions, criteria?}}}',
    );
    return 1;
  }
  const cfg = resolveLayaConfig();
  // An explicit `ask` is a user-initiated DIAGNOSTIC: bypass the mode
  // gate and the confidence gate (nothing acts on this answer) so the
  // human sees the raw probabilities — including the low-confidence
  // ones the pipeline would decline to act on.
  const client = new LayaClient({
    resolvedConfig: { ...cfg, mode: "on", minConfidence: 0 },
  });
  const decision = await client.decide(
    body.state,
    body.questions as Record<string, LayaQuestion>,
  );
  if (decision === null) {
    console.error(
      "✗ laya ask: no usable decision (down / timeout / below min_confidence)",
    );
    return 1;
  }
  console.log(JSON.stringify(decision, null, 2));
  return 0;
}

export async function runLayaEval(
  project: string | undefined,
  opts: { cwd?: string; file?: string },
): Promise<number> {
  let sidecar = opts.file ?? null;
  if (sidecar === null && project !== undefined) {
    const resolved = resolveProjectDir(project, opts.cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return 1;
    }
    sidecar = `${resolved.root}/${SIDECAR_NAME}`;
  }
  if (sidecar === null) {
    console.error("laya eval: pass a project or --file <laya-decisions.jsonl>");
    return 1;
  }
  const rows = await readLayaDecisions(sidecar);
  if (rows.length === 0) {
    console.log(
      `no decisions in ${sidecar} — run a surface in LAYA_MODE=shadow first`,
    );
    return 0;
  }
  const modes = new Set<LayaMode>(rows.map((r) => r.mode));
  console.log(
    `corpus: ${sidecar} (${rows.length} row(s), modes: ${[...modes].join(", ")})`,
  );
  console.log("");
  console.log(
    "surface  shadow-rows  answered  agreed  agreement  gate     verdict",
  );
  console.log(
    "-------  -----------  --------  ------  ---------  -------  -------",
  );
  let allPass = true;
  for (const gate of GATES) {
    const s = summarizeAgreement(rows, gate.surface);
    const pct = s.agreementPct;
    const hasData = pct !== null;
    const pass = hasData && pct >= gate.threshold;
    if (hasData) allPass = allPass && pass;
    console.log(
      [
        gate.surface.padEnd(8),
        String(s.total).padEnd(12),
        String(s.answered).padEnd(8),
        String(s.agreed).padEnd(7),
        (hasData ? `${pct}%` : "—").padEnd(10),
        `≥${gate.threshold}%`.padEnd(8),
        hasData ? (pass ? "PASS" : "FAIL") : "insufficient data",
      ].join("  "),
    );
  }
  console.log("");
  if (allPass) {
    console.log(
      "all surfaces with data meet their §7 gate — promotion to LAYA_MODE=on is justified",
    );
  } else {
    console.log(
      "promotion blocked until every surface with data meets its gate (or stays in shadow)",
    );
  }
  return 0;
}

export function registerLaya(program: Command): void {
  const laya = program
    .command("laya")
    .description(
      "v0.6 local decision-model sidecar diagnostics (health / ask / eval) — advisory only",
    );

  laya
    .command("health")
    .description(
      "probe the local Laya service (/health) and print the resolved config",
    )
    .option("--cwd <dir>", "base directory for config resolution")
    .action(async (opts: { cwd?: string }) => {
      process.exitCode = await runLayaHealth({ cwd: opts.cwd });
    });

  laya
    .command("ask")
    .description(
      'one bounded-decision consult: JSON {"state", "questions"} via --file or stdin',
    )
    .option("--file <path>", "JSON input file (default: stdin)")
    .option("--cwd <dir>", "base directory for config resolution")
    .action(async (opts: { file?: string; cwd?: string }) => {
      process.exitCode = await runLayaAsk(opts.file, { cwd: opts.cwd });
    });

  laya
    .command("eval")
    .description(
      "§7 shadow-agreement table from a project's laya-decisions.jsonl",
    )
    .argument(
      "[project]",
      "project: topic, folder name, path, or unique prefix",
    )
    .option(
      "--file <path>",
      "read this laya-decisions.jsonl instead of a project's",
    )
    .option("--cwd <dir>", "base directory for the project")
    .action(
      async (
        project: string | undefined,
        opts: { file?: string; cwd?: string },
      ) => {
        process.exitCode = await runLayaEval(project, {
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.file !== undefined ? { file: opts.file } : {}),
        });
      },
    );
}
