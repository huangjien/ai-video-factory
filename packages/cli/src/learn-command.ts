import type { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  LESSONS_RELATIVE_PATH,
  REVIEW_QUESTIONS,
  listReviewSessions,
  loadLessonStore,
  mergeSession,
  promptRules,
  saveLessonStore,
  skillUpdateProposal,
  summarizeStore,
  writeReviewSession,
  ReviewSessionSchema,
} from "@video/learn";
import { resolveProjectDir } from "./project-path.js";

/**
 * `video learn` — the human-review learning loop (v1.0).
 *
 * `video make` produces a video; nothing in the pipeline has ever asked
 * a human what they thought of it. This verb closes that gap:
 *
 *   video learn <project>                  show the review prompt + questions
 *   video learn <project> --ask            emit the video-learn/1 envelope (exit 2)
 *   video learn <project> --answer f.yaml  record answers → lessons
 *   video learn --status                   what has been learned so far
 *   video learn --propose                  write a skill-update proposal (never applies)
 *
 * Lessons reach prompts only after corroboration, and skill edits are
 * always a proposal for a human — see @video/learn.
 */

export interface LearnOptions {
  project?: string;
  cwd?: string;
  /** Emit the machine envelope and exit 2 (agent harness path). */
  ask?: boolean;
  /** File holding a `learn-review/1` session (yaml or json). */
  answerFile?: string;
  /** Override the reviewed artifact; defaults to output/final-mixed.mp4. */
  artifact?: string;
  status?: boolean;
  propose?: boolean;
  /** Where `--propose` writes. Default learnings/skill-update-proposal.md. */
  out?: string;
}

/** The repo root owns the cross-project store. Found by walking up to
 *  the pnpm workspace file, so `video learn` works from any subdir. */
export function findRepoRoot(from: string): string {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(from);
    dir = parent;
  }
}

function reviewBrief(project: string, artifact: string): string {
  const lines = [
    `Watch ${artifact} before answering.`,
    "",
    "These questions are OPEN — the options are where you will usually",
    "find your own answer faster, not a menu with one right choice. Say",
    "what actually happened: name scene numbers, quote what you saw.",
    "An answer that just repeats an option is discarded, because it is",
    "not an instruction anyone can act on.",
    "",
  ];
  for (const q of REVIEW_QUESTIONS) {
    lines.push(`${q.id} — ${q.prompt}`);
    for (const o of q.options) lines.push(`    · ${o}`);
    lines.push(`    (${q.hint})`);
    lines.push("");
  }
  lines.push(
    "Record your answers:",
    `  video learn ${project} --answer review.yaml`,
    "",
    "review.yaml shape:",
    "  schema: learn-review/1",
    `  project: ${project}`,
    `  artifact: ${artifact}`,
    "  reviewedAt: 2026-10-17T00:00:00.000Z",
    "  answers:",
    "    - id: image_text",
    "      answer: scenes 4 and 9 came back covered in fake signage",
    "      highConfidence: false      # true = apply without waiting for a 2nd review",
  );
  return lines.join("\n");
}

export async function runLearn(opts: LearnOptions): Promise<number> {
  const repoRoot = findRepoRoot(opts.cwd ?? process.cwd());

  if (opts.propose === true) {
    const store = loadLessonStore(repoRoot);
    const out =
      opts.out !== undefined
        ? opts.out
        : path.join(repoRoot, "learnings", "skill-update-proposal.md");
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, skillUpdateProposal(store), "utf8");
    console.log(`✓ wrote ${path.relative(repoRoot, out)}`);
    console.log(
      "  NOT applied — read it, then fold what you agree with into a SKILL.md",
    );
    return 0;
  }

  if (opts.status === true) {
    const store = loadLessonStore(repoRoot);
    for (const line of summarizeStore(store)) console.log(line);
    const rules = promptRules(store, "image-prompt");
    console.log(
      rules === ""
        ? "\nno image-prompt rules active yet"
        : "\nactive image-prompt rules:",
    );
    if (rules !== "") {
      for (const line of rules.split("\n")) console.log(`  ${line}`);
    }
    return 0;
  }

  if (opts.project === undefined) {
    console.error(
      "video learn needs a project (`video learn <project>`), or --status / --propose",
    );
    return 1;
  }

  const resolved = resolveProjectDir(opts.project, opts.cwd);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const projectRoot = resolved.root;
  const artifact =
    opts.artifact !== undefined
      ? opts.artifact
      : path.join(projectRoot, "output", "final-mixed.mp4");

  if (!existsSync(artifact)) {
    console.error(`nothing to review yet: ${artifact} does not exist`);
    console.error("  run `video make <project>` first");
    return 1;
  }

  if (opts.answerFile !== undefined) {
    let parsed: unknown;
    try {
      const text = readFileSync(opts.answerFile, "utf8");
      parsed = opts.answerFile.endsWith(".json")
        ? JSON.parse(text)
        : parseYaml(text);
    } catch (err) {
      console.error(
        `could not read ${opts.answerFile}: ${(err as Error).message}`,
      );
      return 1;
    }
    // Fill the project/artifact from the CLI when the file omits them —
    // people paste just the answers list.
    const raw = parsed as Record<string, unknown>;
    const candidate = {
      schema: "learn-review/1",
      project: raw["project"] ?? path.basename(projectRoot),
      artifact: raw["artifact"] ?? artifact,
      reviewedAt: raw["reviewedAt"] ?? new Date().toISOString(),
      answers: raw["answers"],
    };
    const result = ReviewSessionSchema.safeParse(candidate);
    if (!result.success) {
      console.error(`review file is not a valid learn-review/1 session:`);
      for (const issue of result.error.issues) {
        console.error(`  ${issue.path.join(".")}: ${issue.message}`);
      }
      return 1;
    }
    const session = result.data;
    const sessionFile = writeReviewSession(projectRoot, session);
    const { store, rejected } = mergeSession(
      loadLessonStore(repoRoot),
      session,
    );
    const storeFile = saveLessonStore(repoRoot, store);
    console.log(
      `✓ recorded ${session.answers.length} answer(s) → ${sessionFile}`,
    );
    console.log(`✓ merged into ${storeFile}`);
    console.log(`  ${store.lessons.length} lesson(s) in the store`);
    if (rejected.length > 0) {
      console.log(
        `  ! ${rejected.length} answer(s) too vague to become lessons:`,
      );
      for (const r of rejected) {
        console.log(`    ${r.id}: "${r.answer}"`);
      }
      console.log(
        '    rewrite them as an instruction, e.g. "scenes 4 and 9 came back covered in fake signage"',
      );
    }
    const active = store.lessons.filter(
      (l) => l.highConfidence || l.seenCount >= 2,
    );
    console.log(
      `  ${active.length} active (reaches prompts after 2 reviews, or high-confidence)`,
    );
    return 0;
  }

  if (opts.ask === true) {
    // Agent path: pure JSON on stdout, exit 2, nothing spent.
    const envelope = {
      protocol: "video-learn/1",
      command: ["learn", opts.project],
      artifact: path.relative(projectRoot, artifact),
      instructions:
        "Watch the artifact, then answer every question in prose. Options are starting points, not a menu — add a topic-aware one if the video calls for it. An answer that only echoes an option is rejected as too vague.",
      questions: REVIEW_QUESTIONS.map((q) => ({
        id: q.id,
        question: q.prompt,
        options: q.options,
        hint: q.hint,
        scope: q.scope,
      })),
    };
    console.log(JSON.stringify(envelope, null, 2));
    return 2;
  }

  const reviewed = listReviewSessions(projectRoot);
  if (reviewed.length > 0) {
    console.log(
      `already reviewed ${reviewed.length} time(s) — last ${reviewed[reviewed.length - 1]?.reviewedAt}`,
    );
  }
  console.log(reviewBrief(opts.project, artifact));
  return 0;
}

export function registerLearn(program: Command): void {
  program
    .command("learn")
    .argument("[project]", "project whose rendered video should be reviewed")
    .option("--cwd <dir>", "base directory for the project")
    .option(
      "--ask",
      "emit the video-learn/1 question envelope as JSON and exit 2 (agent harness)",
    )
    .option(
      "--answer <file>",
      "record answers from a learn-review/1 file (yaml or json)",
    )
    .option(
      "--artifact <path>",
      "reviewed artifact (default: output/final-mixed.mp4)",
    )
    .option("--status", "show what has been learned so far (no project needed)")
    .option(
      "--propose",
      "write learnings/skill-update-proposal.md — NOT applied, for a human to edit",
    )
    .option(
      "--out <file>",
      "where --propose writes (default: learnings/skill-update-proposal.md)",
    )
    .action(
      async (
        project: string | undefined,
        opts: {
          cwd?: string;
          ask?: boolean;
          answer?: string;
          artifact?: string;
          status?: boolean;
          propose?: boolean;
          out?: string;
        },
      ) => {
        process.exitCode = await runLearn({
          ...(project !== undefined ? { project } : {}),
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.ask !== undefined ? { ask: opts.ask } : {}),
          ...(opts.answer !== undefined ? { answerFile: opts.answer } : {}),
          ...(opts.artifact !== undefined ? { artifact: opts.artifact } : {}),
          ...(opts.status !== undefined ? { status: opts.status } : {}),
          ...(opts.propose !== undefined ? { propose: opts.propose } : {}),
          ...(opts.out !== undefined ? { out: opts.out } : {}),
        });
      },
    );
}

/** Exported so `video make` can inject active lessons into image
 *  prompts without the CLI owning the lookup. */
export { loadLessonStore, promptRules, LESSONS_RELATIVE_PATH };
