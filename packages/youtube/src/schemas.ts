import { z } from "zod";

/**
 * YouTube Automation output schema — doc §58 Phase 9.
 * v0.2 phase 7 ships title, description, and chapters (all text).
 * Thumbnail prompt and short-form hook are also text — they describe
 * what the visual assets should look like; the actual image/video
 * generation lands in v0.2 phase 8 (Advanced Media §60).
 */
export const TimestampSchema = z
  .string()
  .regex(/^\d{2}:\d{2}(?::\d{2})?$/, "timestamp must be MM:SS or HH:MM:SS");
export type Timestamp = z.infer<typeof TimestampSchema>;

export const ChapterSchema = z
  .object({
    /** 1-based position of the scene where this chapter starts. The
     *  timestamp is DERIVED from the RENDERED scene durations by the
     *  caller: the model names the scene, the pipeline does the time
     *  arithmetic. A model-computed timestamp drifts by the gap between
     *  the declared and the measured runtime (~25% on a 300 s draft), and
     *  the tail chapters end up pointing past the end of the film. */
    scene: z.number().int().positive(),
    title: z.string().min(1),
    /** The model's own timestamp guess. Optional, and OVERWRITTEN by the
     *  caller when the scene index is usable. */
    timestamp: TimestampSchema.optional(),
  })
  .strict();
export type Chapter = z.infer<typeof ChapterSchema>;

export const YouTubePackageSchema = z
  .object({
    title: z.string().min(1).max(100),
    description: z.string().min(1),
    chapters: z.array(ChapterSchema).min(1),
    thumbnail_prompt: z.string().min(1),
    shorts_hook: z.string().min(1),
  })
  .strict();
export type YouTubePackage = z.infer<typeof YouTubePackageSchema>;
