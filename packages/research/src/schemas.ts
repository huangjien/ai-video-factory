import { z } from "zod";

/**
 * Research output schemas — doc §55 (lines 1128-1158).
 * Three artifacts: research.md (markdown narrative), sources.yaml (provenance),
 * claims.yaml (tagged for verification).
 */

export const SourceSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().url(),
    title: z.string().min(1),
    accessed: z.string().min(1),
    snippet: z.string().min(1),
  })
  .strict();
export type Source = z.infer<typeof SourceSchema>;

export const ClaimStatus = z.enum([
  "fact",
  "opinion",
  "uncertain",
  "needs_human",
]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

export const ClaimSchema = z
  .object({
    id: z.string().min(1),
    claim: z.string().min(1),
    status: ClaimStatus,
    sources: z.array(z.string().min(1)).default([]),
    note: z.string().optional(),
  })
  .strict();
export type Claim = z.infer<typeof ClaimSchema>;

export const ResearchMetaSchema = z
  .object({
    web_search_used: z.boolean(),
    web_search_failed: z.boolean(),
    provider: z.string().min(1),
    model: z.string().min(1),
  })
  .strict();

export const ResearchOutputSchema = z
  .object({
    markdown: z.string().min(1),
    sources: z.array(SourceSchema),
    claims: z.array(ClaimSchema),
    meta: ResearchMetaSchema,
  })
  .strict();
export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
}
