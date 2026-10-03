import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface BigIdeaProps {
  theme?: Theme;
  text: string;
  /** Small label above the statement ("核心观点" / "KEY IDEA"). */
  kicker?: string;
  /** v0.4.2 — `__reveal__` drives the token-by-token reveal; without it
   *  the reveal runs on a frame fallback over the first ~55% of the
   *  scene. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** CJK text has no spaces — split into characters; otherwise words. */
function tokenize(text: string): string[] {
  return /[\u4e00-\u9fa5]/.test(text)
    ? Array.from(text)
    : text.split(/\s+/).filter((t) => t.length > 0);
}

/** Full-screen typographic statement. Tokens (words, or characters for
 *  zh-CN) surface one by one under a small kicker — the "key insight"
 *  beat of an explainer. */
export const BigIdea: FC<BigIdeaProps> = ({
  theme = darkTechTheme,
  text,
  kicker,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  const tokens = tokenize(text);
  const revealP = hasAnimations
    ? progressFor(animations, "__reveal__", sceneSec, Math.max(0.5, durationInFrames * 0.5))
    : Math.max(
        0,
        Math.min(1, frame / Math.max(1, durationInFrames * 0.55)),
      );
  const shownF = revealP * tokens.length;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.background,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div style={{ width: 1500, textAlign: "center" }}>
        {kicker !== undefined ? (
          <p
            style={{
              color: theme.colors.accent,
              fontFamily: theme.typography.subtitle.fontFamily,
              fontSize: 30,
              fontWeight: theme.typography.subtitle.fontWeight,
              letterSpacing: 8,
              margin: "0 0 28px",
            }}
          >
            {kicker}
          </p>
        ) : null}
        <div
          style={{
            width: 140 * Math.min(1, revealP * 3),
            height: 6,
            backgroundColor: theme.colors.accent,
            margin: kicker !== undefined ? "0 auto 44px" : "0 auto 44px",
          }}
        />
        <p
          style={{
            color: theme.colors.primary,
            fontFamily: theme.typography.title.fontFamily,
            fontSize: 84,
            fontWeight: theme.typography.title.fontWeight,
            lineHeight: 1.4,
            margin: 0,
          }}
        >
          {tokens.map((tok, i) => (
            <span key={i} style={{ opacity: Math.max(0, Math.min(1, shownF - i)) }}>
              {tok}
              {/[\u4e00-\u9fa5]/.test(text) ? "" : " "}
            </span>
          ))}
        </p>
      </div>
    </AbsoluteFill>
  );
};
