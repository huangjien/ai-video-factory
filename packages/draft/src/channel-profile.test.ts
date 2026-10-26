import { describe, expect, it } from "vitest";
import {
  CHANNEL_PROFILES,
  channelDraftBlock,
  channelReviewBlock,
  resolveChannelProfile,
  withChannelBlock,
} from "./channel-profile.js";
import { SYSTEM_PROMPT, buildMessages } from "./prompt.js";
import {
  ARTICLE_REVIEW_SYSTEM_PROMPT,
  buildArticleReviewMessages,
} from "./article-review.js";

const base = {
  topic: "玄武门",
  audience: "general",
  language: "zh-CN" as const,
  duration: 300,
};

describe("resolveChannelProfile", () => {
  it("resolves the registered profile", () => {
    expect(resolveChannelProfile("chinese-storybook")).toBe(
      "chinese-storybook",
    );
  });

  it("returns undefined for a typo, an unknown name, or nothing", () => {
    expect(resolveChannelProfile("chinese_storybook")).toBeUndefined();
    expect(resolveChannelProfile("chinese storybook")).toBeUndefined();
    expect(resolveChannelProfile(undefined)).toBeUndefined();
    expect(resolveChannelProfile(null)).toBeUndefined();
  });

  it("lists every profile it can resolve", () => {
    for (const p of CHANNEL_PROFILES) {
      expect(resolveChannelProfile(p)).toBe(p);
    }
  });
});

describe("profile blocks", () => {
  it("are undefined when the profile is off or unrecognised", () => {
    for (const value of [undefined, null, "", "nope"]) {
      expect(channelDraftBlock(value)).toBeUndefined();
      expect(channelReviewBlock(value)).toBeUndefined();
    }
  });

  it("carry the pacing targets CS-03 requires", () => {
    const draft = channelDraftBlock("chinese-storybook");
    expect(draft).toBeTruthy();
    expect(draft).toContain("220");
    expect(draft).toContain("240");
    expect(draft).toContain("55");
    expect(draft).toContain("70");
  });

  it("tell the drafter to relay dialogue instead of staging it", () => {
    const draft = channelDraftBlock("chinese-storybook") ?? "";
    expect(draft).toMatch(/relay/i);
    expect(draft).toMatch(/never write a character's words as quoted speech/i);
  });

  it("keep the single-film narrative arc", () => {
    const draft = channelDraftBlock("chinese-storybook") ?? "";
    for (const beat of ["悬念", "背景", "局势", "选择", "回扣开场"]) {
      expect(draft).toContain(beat);
    }
  });

  it("carry the seven plot engines and the commitment rule", () => {
    const draft = channelDraftBlock("chinese-storybook") ?? "";
    for (const engine of [
      "斩妖除魔",
      "从穷困到富有",
      "探寻",
      "远行与回归",
      "喜剧",
      "悲剧",
      "重生",
    ]) {
      expect(draft).toContain(engine);
    }
    expect(draft).toMatch(/pick ONE primary engine/i);
    expect(draft).toContain("Where is the dip");
  });

  it("give the judge the pacing and dialogue checks", () => {
    const review = channelReviewBlock("chinese-storybook") ?? "";
    expect(review).toMatch(/delivery rate/i);
    expect(review).toMatch(/narration share/i);
    expect(review).toMatch(/stagey dialogue/i);
  });

  it("give the judge the uncommitted-engine check", () => {
    const review = channelReviewBlock("chinese-storybook") ?? "";
    expect(review).toMatch(/uncommitted engine/i);
    for (const engine of ["斩妖除魔", "重生", "悲剧"]) {
      expect(review).toContain(engine);
    }
  });
});

describe("withChannelBlock", () => {
  it("returns the base byte-identical when the profile is off", () => {
    for (const kind of ["draft", "review"] as const) {
      expect(withChannelBlock("BASE", undefined, kind)).toBe("BASE");
      expect(withChannelBlock("BASE", "typo-profile", kind)).toBe("BASE");
    }
  });

  it("appends the block when the profile is on", () => {
    const out = withChannelBlock("BASE", "chinese-storybook", "draft");
    expect(out.startsWith("BASE\n\n")).toBe(true);
    expect(out).toContain("Channel profile");
  });
});

describe("buildMessages (CS-03)", () => {
  it("is byte-identical to SYSTEM_PROMPT without a profile", () => {
    expect(buildMessages(base)[0]?.content).toBe(SYSTEM_PROMPT);
    expect(buildMessages({ ...base, channelProfile: "typo" })[0]?.content).toBe(
      SYSTEM_PROMPT,
    );
  });

  it("adds the channel rules only when the profile is set", () => {
    const on = buildMessages({ ...base, channelProfile: "chinese-storybook" });
    expect(on[0]?.content.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(on[0]?.content).toContain("Channel profile: `chinese-storybook`");
  });

  it("leaves the user message untouched", () => {
    const off = buildMessages(base)[1]?.content;
    const on = buildMessages({
      ...base,
      channelProfile: "chinese-storybook",
    })[1]?.content;
    expect(on).toBe(off);
  });
});

describe("buildArticleReviewMessages (CS-03)", () => {
  it("is byte-identical to the bare judge prompt without a profile", () => {
    expect(buildArticleReviewMessages("# a")[0]?.content).toBe(
      ARTICLE_REVIEW_SYSTEM_PROMPT,
    );
  });

  it("adds the review criteria only when the profile is set", () => {
    const on = buildArticleReviewMessages("# a", "chinese-storybook")[0]
      ?.content;
    expect(on?.startsWith(ARTICLE_REVIEW_SYSTEM_PROMPT)).toBe(true);
    expect(on).toContain("channel profile");
  });

  it("still carries the article being judged in the user message", () => {
    const msgs = buildArticleReviewMessages("# 玄武门", "chinese-storybook");
    expect(msgs[1]?.content).toContain("# 玄武门");
  });
});
