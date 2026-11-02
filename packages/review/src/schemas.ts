import { z } from "zod";

/**
 * Review Agent output schema.
 *
 * This mirrors `packages/prompts/prompts/review.md` exactly. The two
 * used to disagree: the prompt (rewritten 2026-10-24) asks for scalar
 * fields as `{status, evidence, recommendation}` objects and array
 * fields as structured findings, while this schema still demanded bare
 * enums and bare strings. Every real review therefore died on
 * "Review package schema invalid" — the models were right and the
 * schema was stale.
 *
 * `overall` is the human-readable verdict per section (pass | warn |
 * fail); the individual fields carry the concrete observations.
 */
export const ReviewVerdict = z.enum(["pass", "warn", "fail"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

/** Per-field status, as the prompt defines it. */
export const FieldStatus = z.enum(["ok", "warn", "fail"]);
export type FieldStatus = z.infer<typeof FieldStatus>;

/** How severe one structured finding is. */
export const FindingSeverity = z.enum([
  "critical",
  "major",
  "moderate",
  "minor",
]);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

/** A scalar review field: one status plus the evidence behind it.
 *  `evidence` and `recommendation` are tolerated as absent/null — a
 *  field with no evidence is thin, not invalid, and rejecting the whole
 *  package over it loses every other finding in the report. */
export const ScalarFindingSchema = z.object({
  status: FieldStatus,
  evidence: z.string().nullable().optional(),
  recommendation: z.string().nullable().optional(),
});
export type ScalarFinding = z.infer<typeof ScalarFindingSchema>;

/** One entry of an array field. The prompt asks for id / severity /
 *  reference / observation / evidence / recommendation; `reference`,
 *  `evidence` and `recommendation` are tolerated as absent/null for the
 *  same reason as above. */
export const StructuredFindingSchema = z.object({
  id: z.string(),
  severity: FindingSeverity,
  reference: z.string().nullable().optional(),
  observation: z.string(),
  evidence: z.string().nullable().optional(),
  recommendation: z.string().nullable().optional(),
});
export type StructuredFinding = z.infer<typeof StructuredFindingSchema>;

export const ContentReviewSchema = z
  .object({
    accuracy: ScalarFindingSchema,
    logic: ScalarFindingSchema,
    unsupported_claims: z.array(StructuredFindingSchema),
    contradictions: z.array(StructuredFindingSchema),
    repetition: z.array(StructuredFindingSchema),
    overall: ReviewVerdict,
  })
  .strict();

export const VisualReviewSchema = z
  .object({
    readability: ScalarFindingSchema,
    density: ScalarFindingSchema,
    pacing: ScalarFindingSchema,
    visual_hierarchy: ScalarFindingSchema,
    caption_length: ScalarFindingSchema,
    overall: ReviewVerdict,
  })
  .strict();

export const TechnicalReviewSchema = z
  .object({
    resolution: ScalarFindingSchema,
    fps: ScalarFindingSchema,
    audio: ScalarFindingSchema,
    subtitle: ScalarFindingSchema,
    missing_assets: z.array(StructuredFindingSchema),
    render_errors: z.array(StructuredFindingSchema),
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
