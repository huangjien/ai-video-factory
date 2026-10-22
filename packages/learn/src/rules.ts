import { createHash } from "node:crypto";
import { activeLessons } from "./store.js";
import type { LessonScope, LessonStore } from "./schemas.js";

/** Stable short digest of a derived rules block, or "" when there is
 *  nothing. Feeds the image cache key so that activating a lesson
 *  invalidates exactly the images it could improve — `video make
 *  --dry-run` then shows the blast radius before anything is spent. */
export function rulesDigest(rules: string): string {
  const trimmed = rules.trim();
  if (trimmed === "") return "";
  return createHash("sha256").update(trimmed).digest("hex").slice(0, 16);
}

/**
 * Turn learned lessons into text a prompt builder can splice in.
 *
 * Returns `""` when nothing is active — the common case. Every
 * non-empty result is prefixed with the corroboration count so the
 * model (and anyone reading a failed prompt) can see how well-attested
 * each rule is. A one-off reviewer opinion never gets a vote.
 */
export function promptRules(store: LessonStore, scope: LessonScope): string {
  const active = activeLessons(store, scope);
  if (active.length === 0) return "";
  const lines = active.map((lesson) => {
    const strength =
      lesson.seenCount > 1
        ? ` (raised ${lesson.seenCount}×)`
        : " (high confidence)";
    return `- ${lesson.statement}${strength}`;
  });
  return [
    "LEARNED FROM HUMAN REVIEW of previous videos — apply these:",
    ...lines,
    "If a rule conflicts with the scene above, the scene wins.",
  ].join("\n");
}

/** Human-readable status for `video learn --status`. */
export function summarizeStore(store: LessonStore): string[] {
  if (store.lessons.length === 0) {
    return ["learnings/lessons.yaml is empty — no human review recorded yet."];
  }
  const lines: string[] = [
    `${store.lessons.length} lesson(s) recorded from human review:`,
  ];
  for (const scope of ["image-prompt", "draft", "render", "skill"] as const) {
    const all = store.lessons.filter((l) => l.scope === scope);
    if (all.length === 0) continue;
    const active = all.filter(
      (l) => l.highConfidence || l.seenCount >= 2,
    ).length;
    lines.push(`  ${scope}: ${all.length} total, ${active} active`);
  }
  lines.push(
    "  (a lesson becomes active after 2 reviews, or when marked high-confidence)",
  );
  return lines;
}
