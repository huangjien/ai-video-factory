import { loadPrompt } from "@video/prompts";

/**
 * Channel profiles (CS-03).
 *
 * A channel profile is the cross-video grammar — narrator voice, pacing
 * targets, arc shape — and is deliberately NOT the same knob as
 * `image_style`, which is the per-film art style. CS-01 carries the name
 * from `article.md` through to the storyboard and the render plan; this
 * module turns that name into prompt text for the drafter and the judge.
 *
 * Every lookup returns `undefined` for a missing or unknown profile, which
 * is what keeps every pre-profile article on the unchanged prompt. A typo
 * in article.md degrades to "no channel rules", never to broken parsing —
 * the same typo-tolerant contract `image_style` and `channel_profile`
 * already use in ArticleFrontmatterSchema.
 */
export const CHANNEL_PROFILES = ["chinese-storybook"] as const;

export type ChannelProfile = (typeof CHANNEL_PROFILES)[number];

/** Unknown / missing → undefined (no profile rules applied). */
export function resolveChannelProfile(
  value: unknown,
): ChannelProfile | undefined {
  return (CHANNEL_PROFILES as readonly unknown[]).includes(value)
    ? (value as ChannelProfile)
    : undefined;
}

/** Bodies live in `packages/prompts/prompts/` — edit them there. */
const DRAFT_BLOCKS: Record<ChannelProfile, string> = {
  "chinese-storybook": loadPrompt("draft-channel-chinese-storybook"),
};

const REVIEW_BLOCKS: Record<ChannelProfile, string> = {
  "chinese-storybook": loadPrompt("review-channel-chinese-storybook"),
};

/** Extra rules for the drafter's system prompt. Undefined when off. */
export function channelDraftBlock(value: unknown): string | undefined {
  const profile = resolveChannelProfile(value);
  return profile === undefined ? undefined : DRAFT_BLOCKS[profile];
}

/** Extra criteria for the article judge. Undefined when off. */
export function channelReviewBlock(value: unknown): string | undefined {
  const profile = resolveChannelProfile(value);
  return profile === undefined ? undefined : REVIEW_BLOCKS[profile];
}

/**
 * Append a profile block to a base prompt. Returns the base unchanged when
 * the profile is off, so callers can use it unconditionally and an
 * article without a profile produces a byte-identical prompt.
 */
export function withChannelBlock(
  base: string,
  value: unknown,
  kind: "draft" | "review",
): string {
  const block =
    kind === "draft" ? channelDraftBlock(value) : channelReviewBlock(value);
  return block === undefined ? base : `${base}\n\n${block}`;
}
