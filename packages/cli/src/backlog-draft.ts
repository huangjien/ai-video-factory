import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runDraft, type DraftOptions } from "./draft-command.js";
import { findRepoRoot } from "./learn-command.js";
import { ensureProject } from "./ensure-project.js";
import { slugifyProjectName } from "./project-path.js";
import {
  assertTransition,
  isStaleDrafting,
  loadBacklogEntry,
  loadBacklogStore,
  saveBacklogStore,
} from "./backlog-store.js";

/**
 * `video draft --from-backlog <id>` — the pick flow (design §Pick 流程).
 *
 * Guard → stamp `drafting` → scaffold the project → normal draft with the
 * entry's topic (and its long `content` handed to the drafter through the
 * existing `--file`/ideaSeed plumbing) → on success stamp `drafted` +
 * backfill `project`; on ANY non-zero return (including the ask gate's
 * exit 2, where nothing was spent) revert the stamp. `runs/` records stay
 * untouched — the revert only restores the backlog state.
 */

export interface BacklogDraftOptions {
  id: string;
  force?: boolean;
  cwd?: string;
  /** The fully-mapped draft options from the CLI (may already carry
   *  lang/duration/style/…); topic is supplied by the entry. */
  draft: Omit<DraftOptions, "topic">;
}

export async function runDraftFromBacklog(
  opts: BacklogDraftOptions,
): Promise<number> {
  // Backlog discovery and the draft share a base: the explicit cwd wins,
  // then the draft's own --cwd, then the process cwd. `||` not `??`: an
  // empty --cwd must fall through, not resolve to "".
  const draftCwd = opts.cwd || opts.draft.cwd || process.cwd();
  const repoRoot = findRepoRoot(draftCwd);
  const entry = loadBacklogEntry(repoRoot, opts.id);
  if (entry === undefined) {
    console.error(`✗ no backlog entry "${opts.id}"`);
    return 1;
  }
  if (entry.status === "drafted") {
    console.error(
      `✗ "${entry.id}" is already drafted → ${entry.project ?? "(no project recorded)"}`,
    );
    return 1;
  }
  if (entry.status === "dropped") {
    console.error(`✗ "${entry.id}" is dropped — reset it first if you meant to revive it`);
    return 1;
  }
  if (entry.status === "proposed" && opts.force !== true) {
    console.error(
      `✗ "${entry.id}" is a harvested proposal — approve it first (\`video backlog approve ${entry.id}\`) or pass --force`,
    );
    return 1;
  }
  if (entry.status === "drafting") {
    console.log(
      isStaleDrafting(entry)
        ? `  ! "${entry.id}" was left in drafting since ${entry.drafting_at} — re-running now`
        : `  ! "${entry.id}" is already mid-draft — re-running continues it`,
    );
  }

  const slug = slugifyProjectName(entry.topic);
  const previousStatus = entry.status;

  // Stamp drafting. A force-drafted proposal is implicitly approved on
  // its way through (proposed → drafting is not a legal edge; the
  // approval happens first).
  const store = loadBacklogStore(repoRoot);
  const stamped = store.ideas.find((e) => e.id === entry.id)!;
  if (stamped.status === "proposed") stamped.status = "idea";
  assertTransition(stamped, "drafting");
  stamped.status = "drafting";
  stamped.drafting_at = new Date().toISOString();
  saveBacklogStore(repoRoot, store);
  console.log(`▷ backlog ${entry.id} → drafting (project: ${slug})`);

  // The entry's long-form content reaches the drafter through the
  // existing ideaSeed path (`--file <path>` → polished, opinions kept).
  const contentDir = entry.content !== undefined ? mkdtempSync(path.join(tmpdir(), "video-backlog-idea-")) : undefined;
  if (contentDir !== undefined) {
    const ideaFile = path.join(contentDir, "idea.md");
    writeFileSync(ideaFile, entry.content!, "utf8");
    opts.draft = { ...opts.draft, ideaFile };
    console.log(
      `  entry content (${entry.content!.length} chars) injected as drafting context`,
    );
  }

  let code: number;
  try {
    const scaffolded = await ensureProject(
      draftCwd,
      slug,
      path.join(path.resolve(draftCwd), "projects", slug),
    );
    if (scaffolded !== 0) {
      console.error(`✗ could not scaffold projects/${slug}`);
      code = scaffolded;
    } else {
      code = await runDraft({
        ...opts.draft,
        topic: entry.topic,
        ...(entry.lang !== undefined && opts.draft.lang === undefined
          ? { lang: entry.lang }
          : {}),
      });
    }
  } finally {
    if (contentDir !== undefined) rmSync(contentDir, { recursive: true, force: true });
  }

  const finalize = loadBacklogStore(repoRoot);
  const done = finalize.ideas.find((e) => e.id === entry.id)!;
  if (code === 0) {
    assertTransition(done, "drafted");
    done.status = "drafted";
    done.project = slug;
    done.drafted_at = new Date().toISOString();
    saveBacklogStore(repoRoot, finalize);
    console.log(`✓ backlog ${entry.id} → drafted (project: ${slug})`);
  } else {
    // Exit 2 = the ask gate has questions; nothing was spent and the
    // stamp is reverted the same way as a failure.
    assertTransition(done, previousStatus === "proposed" ? "proposed" : "idea", true);
    done.status = previousStatus === "proposed" ? "proposed" : "idea";
    delete done.drafting_at;
    saveBacklogStore(repoRoot, finalize);
    console.error(
      code === 2
        ? `  draft not started (questions pending) — ${entry.id} back to ${done.status}`
        : `✗ draft failed (exit ${code}) — ${entry.id} back to ${done.status}`,
    );
  }
  return code;
}
