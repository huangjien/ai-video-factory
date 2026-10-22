import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import {
  LessonStoreSchema,
  ReviewSessionSchema,
  isActiveLesson,
  type Lesson,
  type LessonStore,
  type ReviewAnswer,
  type ReviewSession,
} from "./schemas.js";
import { REVIEW_QUESTIONS } from "./questions.js";

/** Repo-root location of the cross-project store. Human-authored,
 *  reviewed by diff — never generated silently by a render. */
export const LESSONS_RELATIVE_PATH = path.join("learnings", "lessons.yaml");
export const LEARNINGS_DIRNAME = "learnings";

/**
 * Turn a free-text answer into a lesson statement.
 *
 * Rejects answers that are just the option label back ("too busy") —
 * those carry no instruction, and promoting one into a prompt rule just
 * injects noise forever. The caller turns a rejection into a re-ask.
 */
export function toLessonStatement(answer: string): string | null {
  const trimmed = answer.trim().replace(/\s+/g, " ");
  if (trimmed.length < 12) return null;
  // Echoing the menu back is not an instruction. Match the label OR any
  // prefix of it — "mostly match" is the reviewer picking row 2, not
  // telling us what was wrong.
  const lower = trimmed.toLowerCase();
  const echoesOption = REVIEW_QUESTIONS.some((q) =>
    q.options.some((o) => {
      const label = o.toLowerCase();
      return label === lower || label.startsWith(lower);
    }),
  );
  if (echoesOption) return null;
  return trimmed;
}

/** Stable identity: scope + normalized statement. Casing, trailing
 *  punctuation and spacing must not fork one lesson into five. */
export function lessonId(scope: string, statement: string): string {
  const norm = statement
    .toLowerCase()
    .replace(/[.。!！?？,，;；]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${scope}:${norm}`;
}

export function emptyLessonStore(): LessonStore {
  return { schema: "learn-lessons/1", lessons: [] };
}

export function loadLessonStore(repoRoot: string): LessonStore {
  const file = path.join(repoRoot, LESSONS_RELATIVE_PATH);
  if (!existsSync(file)) return emptyLessonStore();
  try {
    // Hand-edited file: a typo must degrade to "no lessons yet", never
    // brick a render. Same philosophy as image_style / the Visual Bible.
    return LessonStoreSchema.parse(parseYaml(readFileSync(file, "utf8")));
  } catch {
    return emptyLessonStore();
  }
}

export function saveLessonStore(repoRoot: string, store: LessonStore): string {
  const file = path.join(repoRoot, LESSONS_RELATIVE_PATH);
  mkdirSync(path.dirname(file), { recursive: true });
  const parsed = LessonStoreSchema.parse(store);
  writeFileSync(file, yamlStringify(parsed), "utf8");
  return file;
}

/** Fold one review session into the store. Returns the merged store plus
 *  the statements that were too vague to become lessons. */
export function mergeSession(
  store: LessonStore,
  session: ReviewSession,
): { store: LessonStore; rejected: { id: string; answer: string }[] } {
  const parsed = ReviewSessionSchema.parse(session);
  const byId = new Map(store.lessons.map((l) => [l.id, l]));
  const rejected: { id: string; answer: string }[] = [];

  for (const answer of parsed.answers) {
    const q = REVIEW_QUESTIONS.find((item) => item.id === answer.id);
    // An answer to a question this build does not know is data we cannot
    // route to a scope — drop it rather than guess.
    if (q === undefined) {
      rejected.push({ id: answer.id, answer: answer.answer });
      continue;
    }
    const statement = toLessonStatement(answer.answer);
    if (statement === null) {
      rejected.push({ id: answer.id, answer: answer.answer });
      continue;
    }
    const id = lessonId(q.scope, statement);
    const existing = byId.get(id);
    if (existing === undefined) {
      byId.set(id, {
        id,
        scope: q.scope,
        statement,
        seenCount: 1,
        projects: [...new Set([parsed.project])],
        firstSeenAt: parsed.reviewedAt,
        lastSeenAt: parsed.reviewedAt,
        highConfidence: answer.highConfidence === true,
      });
    } else {
      existing.seenCount += 1;
      existing.projects = [...new Set([...existing.projects, parsed.project])];
      existing.lastSeenAt = parsed.reviewedAt;
      existing.highConfidence =
        existing.highConfidence || answer.highConfidence === true;
    }
  }

  return {
    store: { schema: "learn-lessons/1", lessons: [...byId.values()] },
    rejected,
  };
}

/** Per-project record of what was reviewed and what was learned. */
export function writeReviewSession(
  projectRoot: string,
  session: ReviewSession,
): string {
  const dir = path.join(projectRoot, LEARNINGS_DIRNAME);
  mkdirSync(dir, { recursive: true });
  const parsed = ReviewSessionSchema.parse(session);
  const stamp = parsed.reviewedAt.replace(/[:.]/g, "-");
  const file = path.join(dir, `review-${stamp}.yaml`);
  writeFileSync(file, yamlStringify(parsed), "utf8");
  return file;
}

export function listReviewSessions(projectRoot: string): ReviewSession[] {
  const dir = path.join(projectRoot, LEARNINGS_DIRNAME);
  if (!existsSync(dir)) return [];
  const out: ReviewSession[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".yaml")) continue;
    try {
      out.push(
        ReviewSessionSchema.parse(
          parseYaml(readFileSync(path.join(dir, name), "utf8")),
        ),
      );
    } catch {
      // skip unreadable session files
    }
  }
  return out;
}

/** Active lessons for one scope, most-repeated first. */
export function activeLessons(
  store: LessonStore,
  scope: Lesson["scope"],
): Lesson[] {
  return store.lessons
    .filter((l) => l.scope === scope && isActiveLesson(l))
    .sort((a, b) => b.seenCount - a.seenCount || a.id.localeCompare(b.id));
}
