import { z } from "zod/v3";

/**
 * Douyin (抖音) submission metadata.
 *
 * Douyin HAS an official publishing API (开放平台 → 内容发布), so unlike
 * Bilibili this package is not packaging-only. It still produces the
 * metadata as a file first: the API needs the same fields a human would
 * type into creator.douyin.com, and a file is the thing you can READ when
 * the API rejects a post — and the thing the manual fallback hands over
 * when the credentials are not there yet.
 *
 * Field limits below are the creator platform's form constraints. They
 * are enforced before a submission is wasted on them:
 *
 *   - title       ≤ 55 characters (the 作品标题 field)
 *   - description ≤ 2200 characters (the 文案 field)
 *   - topics      ≤ 5, each ≤ 20 characters (话题 — Douyin shows them as
 *                 hashtags under the post, and they are how a post travels
 *                 outside the follower feed)
 *
 * Verify against the live form before trusting them for a long-running
 * automated pipeline — Douyin has changed its limits before.
 */
export const DOUYIN_TITLE_MAX = 55;
export const DOUYIN_DESCRIPTION_MAX = 2200;
export const DOUYIN_TOPICS_MAX = 5;
export const DOUYIN_TOPIC_MAX = 20;

/** The vertical frame Douyin is built around. */
export const DOUYIN_WIDTH = 1080;
export const DOUYIN_HEIGHT = 1920;

export const DouyinPackageSchema = z
  .object({
    /** 作品标题 — the one line under the thumbnail in the feed. */
    title: z.string().min(1).max(DOUYIN_TITLE_MAX),
    /** 文案 — the caption under the video, where a post earns its click. */
    description: z.string().min(1).max(DOUYIN_DESCRIPTION_MAX),
    /** 话题 — the hashtags. Douyin strips a leading '#'. */
    topics: z
      .array(z.string().min(1).max(DOUYIN_TOPIC_MAX))
      .max(DOUYIN_TOPICS_MAX),
    /** Cover-image brief, same contract as YouTube's thumbnail_prompt: a
     * visual scene, never a layout with type. The title is typeset by the
     * uploader afterwards. */
    cover_prompt: z.string().min(1),
  })
  .strict();

export type DouyinPackage = z.infer<typeof DouyinPackageSchema>;

/** What a successful publish returns — the id the stats join reads. */
export const DouyinPublishResultSchema = z
  .object({
    /** The item id Douyin assigns to the post (分享链接里的 id). */
    item_id: z.string().min(1),
    /** The share URL, when the API returns one. */
    share_url: z.string().optional(),
    /** The video id the API assigned before the commit. */
    video_id: z.string().optional(),
  })
  .strict();

export type DouyinPublishResult = z.infer<typeof DouyinPublishResultSchema>;
