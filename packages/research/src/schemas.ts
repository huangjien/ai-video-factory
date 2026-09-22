import { z } from "zod";

/**
 * Research output schemas — doc §55 (lines 1128-1158).
 * Three artifacts: research.md (markdown narrative), sources.yaml (provenance),
 * claims.yaml (tagged for verification).
 */

/**
 * Repair the slightly-malformed URLs LLMs commonly emit before zod's
 * strict `.url()` sees them:
 *   - "www.example.com/x"        → "https://www.example.com/x"   (missing protocol)
 *   - " https://example.com "    → "https://example.com"          (padding)
 *   - "https://x.com/a b"        → "https://x.com/a%20b"          (raw space)
 *   - "https://x.com/page （注释）" → "https://x.com/page"          (trailing prose)
 * Anything still unparseable passes through unchanged so the schema
 * reports it as a validation error (visible to the user) instead of
 * being silently mangled.
 */
export function normalizeUrl(raw: string): string {
  let s = raw.trim();
  // Cut trailing prose (CJK annotation, parenthetical note) that follows
  // the URL. ASCII spaces are NOT prose delimiters — a space mid-path is
  // encoded below instead.
  const cut = s.search(/[（(<>「【《]/);
  if (cut > 0) s = s.slice(0, cut).trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  const bareDomain = !hasScheme && /^[\w-]+(\.[\w-]+)+\//.test(s);
  if (bareDomain) s = `https://${s}`;
  // Percent-encode raw spaces only when this is actually a URL;
  // free text passes through untouched so the schema can reject it.
  if (hasScheme || bareDomain) {
    s = s.replace(/ /g, "%20");
  }
  return s;
}

export const SourceSchema = z
  .object({
    id: z.string().min(1),
    url: z.preprocess(normalizeUrl, z.string().url()),
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
