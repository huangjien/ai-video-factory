import { z } from "zod";

/**
 * Review Agent output schema — doc §31 (three review sections).
 * `overall` is the human-readable verdict per section (pass | warn | fail);
 * the individual fields carry the concrete observations.
 */
export const ReviewVerdict = z.enum(["pass", "warn", "fail"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

export const ContentReviewSchema = z
  .object({
    accuracy: z.enum(["ok", "warn", "fail"]),
    logic: z.enum(["ok", "warn", "fail"]),
    unsupported_claims: z.array(z.string()),
    contradictions: z.array(z.string()),
    repetition: z.array(z.string()),
    overall: ReviewVerdict,
  })
  .strict();

export const VisualReviewSchema = z
  .object({
    readability: z.enum(["ok", "warn", "fail"]),
    density: z.enum(["ok", "warn", "fail"]),
    pacing: z.enum(["ok", "warn", "fail"]),
    visual_hierarchy: z.enum(["ok", "warn", "fail"]),
    caption_length: z.enum(["ok", "warn", "fail"]),
    overall: ReviewVerdict,
  })
  .strict();

export const TechnicalReviewSchema = z
  .object({
    resolution: z.enum(["ok", "warn", "fail"]),
    fps: z.enum(["ok", "warn", "fail"]),
    audio: z.enum(["ok", "warn", "fail"]),
    subtitle: z.enum(["ok", "warn", "fail"]),
    missing_assets: z.array(z.string()),
    render_errors: z.array(z.string()),
    overall: ReviewVerdict,
  })
  .strict();

export const ReviewPackageSchema = z
  .object({
    content: ContentReviewSchema,
    visual: VisualReviewSchema,
    technical: TechnicalReviewSchema,
  })
  .strict();

export type ContentReview = z.infer<typeof ContentReviewSchema>;
export type VisualReview = z.infer<typeof VisualReviewSchema>;
export type TechnicalReview = z.infer<typeof TechnicalReviewSchema>;
export type ReviewPackage = z.infer<typeof ReviewPackageSchema>;
