import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade, scale } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface QuoteBlockProps {
  theme?: Theme;
  quote: string;
  author?: string;
  source?: string;
  /** v0.4.2 — `__quote__` drives the card entrance, `__author__` the
   *  attribution fade. When absent, frame-based fallbacks run. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** Full-screen quotation card: oversized opening mark, the quote, then a
 *  rule that draws left-to-right before the attribution fades in. */
export const QuoteBlock: FC<QuoteBlockProps> = ({
  theme = darkTechTheme,
  quote,
  author,
  source,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  const cardP = hasAnimations
    ? progressFor(animations, "__quote__", sceneSec, 0.6)
    : fade(frame, 20);
  const authorP = hasAnimations
    ? progressFor(animations, "__author__", sceneSec, 0.5)
    : fade(frame - 20, 20);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.background,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 1400,
          backgroundColor: theme.colors.surface,
          borderRadius: 20,
          border: `2px solid ${theme.colors.accent}`,
          padding: "72px 96px",
          opacity: cardP,
          transform: `scale(${scale(frame * cardP, 0.96)})`,
        }}
      >
        <div
          style={{
            color: theme.colors.accent,
            fontFamily: theme.typography.title.fontFamily,
            fontSize: 160,
            lineHeight: 0.6,
            height: 90,
            opacity: 0.55,
          }}
        >
          “
        </div>
        <p
          style={{
            color: theme.colors.primary,
            fontFamily: theme.typography.subtitle.fontFamily,
            fontSize: 52,
            lineHeight: 1.55,
            margin: "24px 0 0",
          }}
        >
          {quote}
        </p>
        <div
          style={{
            width: 160 * cardP,
            height: 4,
            backgroundColor: theme.colors.accent,
            margin: "40px 0 24px",
            marginLeft: "auto",
          }}
        />
        {author !== undefined || source !== undefined ? (
          <p
            style={{
              color: theme.colors.secondary,
              fontFamily: theme.typography.body.fontFamily,
              fontSize: 30,
              margin: 0,
              textAlign: "right",
              opacity: authorP,
            }}
          >
            —— {author ?? ""}
            {author !== undefined && source !== undefined ? " · " : ""}
            {source ?? ""}
          </p>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
