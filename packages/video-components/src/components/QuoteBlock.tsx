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
  /** A short kicker (e.g. "原则 / PRinciple") rendered above the quote,
   *  often used to introduce the quote's category. */
  kicker?: string;
  /** v0.4.2 — `__quote__` drives the card entrance, `__author__` the
   *  attribution fade. When absent, frame-based fallbacks run. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** Full-screen quotation card. The opening mark is a large accent-
 *  colored SVG quote glyph, the quote flows below it, then a horizontal
 *  rule draws left-to-right before the attribution fades in. */
export const QuoteBlock: FC<QuoteBlockProps> = ({
  theme = darkTechTheme,
  quote,
  author,
  source,
  kicker,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  const cardOpacity = hasAnimations
    ? progressFor(animations, "__quote__", sceneSec, 0.5)
    : fade(frame, 24);
  // The horizontal rule grows from 0 to full width as the rule animation
  // completes. Frame fallback: linear grow over the first 1.2 s.
  const ruleProgress = hasAnimations
    ? progressFor(animations, "__quote__", sceneSec, 0.5)
    : Math.min(1, frame / 36);
  const authorOpacity = hasAnimations
    ? progressFor(animations, "__author__", sceneSec, 0.5)
    : Math.max(0, (frame - 24) / 30);
  // Subtle scale-up on entrance for the whole card.
  const enterScale = scale(frame, 24);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "transparent",
        justifyContent: "center",
        alignItems: "center",
        opacity: cardOpacity,
      }}
    >
      <div
        style={{
          width: 1300,
          padding: "56px 72px",
          backgroundColor: theme.colors.surface,
          borderRadius: 20,
          border: `1.5px solid ${theme.colors.accent}`,
          borderLeft: `10px solid ${theme.colors.accent}`,
          boxShadow:
            "0 20px 48px rgba(15, 23, 42, 0.10), 0 4px 12px rgba(15, 23, 42, 0.06)",
          transform: `scale(${enterScale})`,
        }}
      >
        {/* Kicker (optional) — small uppercase label above the quote. */}
        {kicker !== undefined ? (
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              color: theme.colors.accent,
              fontFamily: theme.typography.subtitle.fontFamily,
              marginBottom: 16,
            }}
          >
            {kicker}
          </div>
        ) : null}
        {/* The opening quote glyph — an SVG path of two curl marks.
            It's a styled accent, not a unicode character, so it
            doesn't depend on the font supporting U+201C. */}
        <svg
          width={64}
          height={48}
          viewBox="0 0 64 48"
          style={{ marginBottom: 18 }}
          aria-hidden
        >
          <path
            d="M 8 32 Q 8 8 24 8 L 24 18 Q 16 18 16 28 L 28 28 L 28 38 L 8 38 Z M 36 32 Q 36 8 52 8 L 52 18 Q 44 18 44 28 L 56 28 L 56 38 L 36 38 Z"
            fill={theme.colors.accent}
            opacity={0.65}
          />
        </svg>
        {/* The quote text — wraps, larger font, with a slight letter-
            spacing for a typographic "pull-quote" feel. */}
        <div
          style={{
            fontSize: 40,
            lineHeight: 1.45,
            color: theme.colors.primary,
            fontWeight: 500,
            fontFamily: theme.typography.title.fontFamily,
            letterSpacing: 0.5,
            marginBottom: 28,
          }}
        >
          {quote}
        </div>
        {/* Horizontal rule — grows from 0 to its full width as the
            scene's entrance completes. Anchored on the left so the
            rule reads as a "trail" from the quote down to the source. */}
        <div
          style={{
            height: 2,
            width: 600,
            maxWidth: `${ruleProgress * 100}%`,
            background: `linear-gradient(90deg, ${theme.colors.accent}, ${theme.colors.accent}33)`,
            marginBottom: 20,
            transition: "max-width 120ms linear",
          }}
        />
        {/* Attribution — author on the left, optional source on the
            right. The whole line fades in after the rule has started
            drawing. */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            opacity: authorOpacity,
            color: theme.colors.secondary,
          }}
        >
          <span
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: theme.colors.primary,
              fontFamily: theme.typography.subtitle.fontFamily,
            }}
          >
            {author !== undefined ? `— ${author}` : ""}
          </span>
          {source !== undefined ? (
            <span
              style={{
                fontSize: 18,
                fontStyle: "italic",
                fontFamily: theme.typography.body.fontFamily,
              }}
            >
              {source}
            </span>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};
