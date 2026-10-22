import { z } from "zod";

/**
 * Bilibili submission metadata.
 *
 * There is NO public upload API on Bilibili (unlike YouTube's Data API v3),
 * so this package is deliberately packaging-only: it produces the fields the
 * uploader types into the web submission form. Nothing here talks to
 * Bilibili.
 *
 * Field limits below are Bilibili's web-form constraints. They are the ones
 * the form silently truncates or rejects, so the schema enforces them before
 * a human wastes a submission on them:
 *
 *   - title       ≤ 80 characters (counted as characters, not bytes)
 *   - description ≤ 2000 characters
 *   - tags        ≤ 10, each ≤ 20 characters
 *
 * Verify against the live form before trusting them for a long-running
 * automated pipeline — they have changed before and will change again.
 */
export const BILIBILI_TITLE_MAX = 80;
export const BILIBILI_DESCRIPTION_MAX = 2000;
export const BILIBILI_TAGS_MAX = 10;
export const BILIBILI_TAG_MAX = 20;

export const BilibiliPackageSchema = z
  .object({
    title: z.string().min(1).max(BILIBILI_TITLE_MAX),
    /** 简介 — the long-form blurb under the video. */
    description: z.string().min(1).max(BILIBILI_DESCRIPTION_MAX),
    /** 标签 — Bilibili allows at most 10, and they are how a video gets
     * surfaced outside the subscriber feed. */
    tags: z
      .array(z.string().min(1).max(BILIBILI_TAG_MAX))
      .max(BILIBILI_TAGS_MAX),
    /**
     * 分区 — the section a video is filed under, as a human-readable name
     * ("科技", "计算机技术", …).
     *
     * Deliberately a NAME and not a numeric `tid`. A wrong tid does not
     * error — it files the video into an unrelated section, and the creator
     * only notices after publishing. A name the human can check against the
     * form's dropdown fails loudly instead. `null` means "no confident
     * pick" and the checklist tells the uploader to choose.
     */
    suggested_category: z.string().nullable(),
    /** Cover-image brief, same contract as YouTube's thumbnail_prompt: a
     * visual scene, never a layout with type. The title is typeset by the
     * uploader afterwards. */
    cover_prompt: z.string().min(1),
  })
  .strict();

export type BilibiliPackage = z.infer<typeof BilibiliPackageSchema>;
