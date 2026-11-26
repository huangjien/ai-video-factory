/**
 * `video decision harvest` — turn the shadow log's disagreements into
 * corpus candidates.
 *
 * The shadow pass records every fall-through scene's decision beside the
 * keyword classifier's answer. A DISAGREEMENT is the interesting event:
 * two readers of the same scene, one of them wrong. Every disagreement
 * is a corpus case waiting to be written — with the real state, the
 * real artifact, and a label a human has to confirm.
 *
 * The harvest does the transcription and nothing else:
 *
 *  - the state is recovered from the project's `article.md` (the log
 *    keeps only a hash of it), so the candidate cannot drift;
 *  - the decision's answer is written as a PROPOSED label and the case
 *    is marked `disputed`, because a proposal is not a label;
 *  - the candidates are written to `<project>/decision-candidates.yaml`
 *    — a REVIEW queue, not the corpus. A human moves the cases they
 *    agree with into `packages/prompts/decisions/visual-class/`.
 */
import type { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import {
  harvestDraftBarCandidates,
  parseDecisionLog,
  runDraftDecisionShadow,
  type DecisionCandidate,
  type DraftBarAttemptFacts,
  type DraftDecisionRow,
} from "@video/draft";
import { createDecisionProvider, decisionLogPath } from "@video/llm";
import { resolveProjectDir } from "./project-path.js";

/** The candidate file as YAML — the same shape a corpus case has, so a
 *  reviewed candidate can be moved into the corpus unchanged. */
export function renderCandidateYaml(candidates: DecisionCandidate[]): string {
  return yamlStringify(candidates.length === 0 ? {} : { cases: candidates }, {
    indent: 2,
    lineWidth: 0,
  });
}

/** Read a project's log and turn it into candidates. */
export async function harvestProject(
  projectRoot: string,
  projectName: string,
): Promise<{ candidates: DecisionCandidate[]; rows: number }> {
  const logPath = path.join(projectRoot, "decision-log.jsonl");
  let rows: ReturnType<typeof parseDecisionLog> = [];
  try {
    rows = parseDecisionLog(await readFile(logPath, "utf8"));
  } catch {
    rows = [];
  }
  // The review artifact — the draft-bar surface's ground truth.
  const attempts = await readReviewAttempts(projectRoot);

  const draftRows = rows.filter(
    (row): row is DraftDecisionRow => row.surface === "draft-bar",
  );
  const candidates = harvestDraftBarCandidates({
    rows: draftRows,
    attempts,
    project: projectName,
  });
  return { candidates, rows: rows.length };
}

/** The review artifact's attempt facts — the ground truth the draft-bar
 *  labels are derived from. */
export async function readReviewAttempts(
  projectRoot: string,
): Promise<DraftBarAttemptFacts[]> {
  try {
    const review = parseYaml(
      await readFile(path.join(projectRoot, "article-review.yaml"), "utf8"),
    ) as {
      attempts?: {
        attempt?: number;
        overall?: number | null;
        grade?: string | null;
        passing?: boolean;
        findings?: DraftBarAttemptFacts["findings"];
        risk_flags?: DraftBarAttemptFacts["risk_flags"];
      }[];
    };
    return (review.attempts ?? []).map((attempt, index) => ({
      attempt: attempt.attempt ?? index + 1,
      overall: attempt.overall ?? undefined,
      grade: attempt.grade ?? undefined,
      passing: Boolean(attempt.passing),
      findings: attempt.findings ?? undefined,
      risk_flags: attempt.risk_flags ?? undefined,
    }));
  } catch {
    return [];
  }
}

/** `video decision backfill <project>` — consult the decision model
 *  about a project's ALREADY REVIEWED attempts.
 *
 *  No draft is re-run: the review artifact on disk holds every attempt
 *  the draft loop produced, with its findings and its verdict. The
 *  consult is a single API call per attempt, and the answers land in
 *  the same decision log the shadow pass writes — so the harvest can
 *  turn them into corpus cases.
 */
export function registerDecisionBackfill(decision: Command): void {
  decision
    .command("backfill")
    .description(
      "Consult the decision model about a project's existing review attempts (no draft is re-run).",
    )
    .argument("<project>", "project topic, folder name, path, or unique prefix")
    .option("--cwd <dir>", "resolve the project from this directory")
    .option("--max <n>", "how many attempts to consult", "4")
    .option("--provider <id>", "openai | minimax")
    .option("--model <id>", "override the model id")
    .action(
      async (project: string, options: Record<string, string | boolean>) => {
        const resolved = resolveProjectDir(
          project,
          typeof options["cwd"] === "string" ? options["cwd"] : process.cwd(),
        );
        if (!resolved.ok) {
          console.error(resolved.message);
          process.exitCode = 1;
          return;
        }
        const projectRoot = resolved.root;
        const attempts = await readReviewAttempts(projectRoot);
        if (attempts.length === 0) {
          console.log(
            "no article-review.yaml — run `video draft` first, or point at a project that has one",
          );
          return;
        }
        const provider =
          typeof options["provider"] === "string"
            ? createDecisionProvider({ provider: options["provider"] })
            : typeof options["model"] === "string"
              ? createDecisionProvider({ model: options["model"] })
              : undefined;
        const result = await runDraftDecisionShadow({
          project: path.basename(projectRoot),
          attempts,
          mode: "shadow",
          ...(provider !== undefined ? { provider } : {}),
          logPath: decisionLogPath(projectRoot),
          maxConsults: Number(options["max"] ?? 4),
        });
        console.log(
          `${result.consulted} attempt(s) consulted, ${result.agreed} agreed with the review's verdict → ${decisionLogPath(projectRoot)}`,
        );
        console.log(
          "  next: `video decision harvest " +
            path.basename(projectRoot) +
            "` turns the answers into corpus candidates",
        );
      },
    );
}

/** `video decision harvest` — the verb. */
export function registerDecisionHarvest(decision: Command): void {
  decision
    .command("harvest")
    .description(
      "Turn a project's shadow-log disagreements into review-ready corpus candidates.",
    )
    .argument("<project>", "project topic, folder name, path, or unique prefix")
    .option("--cwd <dir>", "resolve the project from this directory")
    .option("--out <path>", "where to write the candidates")
    .option("--print", "print the candidates instead of writing them")
    .action(
      async (project: string, options: Record<string, string | boolean>) => {
        const resolved = resolveProjectDir(
          project,
          typeof options["cwd"] === "string" ? options["cwd"] : process.cwd(),
        );
        if (!resolved.ok) {
          console.error(resolved.message);
          process.exitCode = 1;
          return;
        }
        const projectRoot = resolved.root;
        const { candidates, rows } = await harvestProject(
          projectRoot,
          path.basename(projectRoot),
        );
        if (rows === 0) {
          console.log(
            "no decision log — run the draft with DECISION_MODE=shadow first",
          );
          return;
        }
        const yaml = renderCandidateYaml(candidates);
        if (options["print"]) {
          console.log(yaml);
          return;
        }
        const out =
          typeof options["out"] === "string"
            ? options["out"]
            : path.join(projectRoot, "decision-candidates.yaml");
        await writeFile(out, yaml, "utf8");
        console.log(
          `${candidates.length} candidate(s) from ${rows} logged consult(s) → ${out}`,
        );
        if (candidates.length > 0) {
          console.log(
            "  each label is the decision model's PROPOSAL — review them, then move the ones you agree with into packages/prompts/decisions/visual-class/",
          );
        }
      },
    );
}
