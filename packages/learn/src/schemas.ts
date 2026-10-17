import { z } from "zod";

/**
 * Human-review learning loop (v1.0).
 *
 * After a render exists, a human watches it and answers questions about
 * what actually landed. Those answers become *lessons* — small, durable,
 * cross-project statements about what to do differently next time.
 *
 * Two rules shape everything here:
 *
 *  1. **A lesson never reaches a prompt on first sight.** One reviewer
 *     having a bad day must not silently rewrite every future render.
 *     A lesson becomes active only after it is corroborated (seen twice)
 *     or the reviewer explicitly marks it high-confidence.
 *  2. **Lessons are not edits.** This package derives prompt rules and
 *     *proposes* skill changes; it never rewrites `article.md`, a prompt
 *     preset, or a SKILL.md. A human applies anything durable.
 */

/** Where a lesson is allowed to take effect. */
export const LESSON_SCOPES = ["image-prompt", "draft", "render", "skill"] as const;
export type LessonScope = (typeof LESSON_SCOPES)[number];

export const ReviewQuestionSchema = z.object({
  id: z.string().min(1),
  /** Open question — the answer is prose, not a menu pick. */
  prompt: z.string().min(1),
  /** Starting points, not a closed set. The harness may add a
   *  topic-aware option (mirrors video-ask/1 rule 3). */
  options: z.array(z.string().min(1)).min(1),
  /** What a good answer looks like — shown to the reviewer as a hint. */
  hint: z.string().min(1),
  /** Which sink a lesson from this question would feed. */
  scope: z.enum(LESSON_SCOPES),
});
export type ReviewQuestion = z.infer<typeof ReviewQuestionSchema>;

export const ReviewAnswerSchema = z.object({
  /** The `id` of the question being answered. */
  id: z.string().min(1),
  /** Prose from the reviewer. Never a bare option label — the label is
   *  a starting point, the answer must say what actually happened. */
  answer: z.string().min(1),
  /** Reviewer asserts this lesson is safe to apply immediately, without
   *  waiting for corroboration. Use for hard facts ("the title always
   *  renders at 9px and clips"), not taste. */
  highConfidence: z.boolean().optional(),
});
export type ReviewAnswer = z.infer<typeof ReviewAnswerSchema>;

export const ReviewSessionSchema = z.object({
  schema: z.literal("learn-review/1"),
  project: z.string().min(1),
  /** The rendered artifact the reviewer watched. */
  artifact: z.string().min(1),
  reviewedAt: z.string().min(1),
  answers: z.array(ReviewAnswerSchema).min(1),
});
export type ReviewSession = z.infer<typeof ReviewSessionSchema>;

export const LessonSchema = z.object({
  /** Stable identity: scope + normalized statement. */
  id: z.string().min(1),
  scope: z.enum(LESSON_SCOPES),
  /** The lesson in imperative form: "keep the lower third clear". */
  statement: z.string().min(1),
  /** How many separate review sessions surfaced it. */
  seenCount: z.number().int().min(1),
  /** Projects it was observed in. */
  projects: z.array(z.string().min(1)),
  firstSeenAt: z.string().min(1),
  lastSeenAt: z.string().min(1),
  /** Reviewer marked at least one occurrence high-confidence. */
  highConfidence: z.boolean(),
});
export type Lesson = z.infer<typeof LessonSchema>;

export const LessonStoreSchema = z.object({
  schema: z.literal("learn-lessons/1"),
  lessons: z.array(LessonSchema),
});
export type LessonStore = z.infer<typeof LessonStoreSchema>;

/** A lesson may steer a prompt once it is corroborated or trusted. */
export function isActiveLesson(lesson: Lesson): boolean {
  return lesson.highConfidence || lesson.seenCount >= 2;
}