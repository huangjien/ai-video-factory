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
    timestamp: TimestampSchema,
    title: z.string().min(1),
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
