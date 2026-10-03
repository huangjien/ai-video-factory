import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface LeaderboardEntry {
  name: string;
  score?: string;
}

export interface LeaderboardProps {
  theme?: Theme;
  entries: LeaderboardEntry[];
  title?: string;
  /** v0.4.2 — `rank-${i}` slides each row in. Rows reveal bottom-up
   *  (worst first) so the #1 spot lands last. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** Ranked list, 1st place on top with an accent badge and border. Rows
 *  rise in from below; the emitter (and the frame fallback) reveals them
 *  from the bottom of the table upward for a countdown feel. */
export const Leaderboard: FC<LeaderboardProps> = ({
  theme = darkTechTheme,
  entries = [],
  title,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  const shown = entries.slice(0, 6);
  const n = shown.length;
  const rowH = Math.min(130, 720 / Math.max(1, n));
  const top = 1080 / 2 - (n * rowH) / 2 + (title !== undefined ? 40 : 0);
  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      {title !== undefined ? (
        <h3
          style={{
            position: "absolute",
            top: top - 120,
            width: "100%",
            textAlign: "center",
            color: theme.colors.primary,
            fontFamily: theme.typography.subtitle.fontFamily,
            fontSize: theme.typography.subtitle.fontSize,
            margin: 0,
          }}
        >
          {title}
        </h3>
      ) : null}
      {shown.map((e, i) => {
        // Reveal order is bottom-up: the last row animates first.
        const order = n - 1 - i;
        const p = hasAnimations
          ? progressFor(animations, `rank-${i}`, sceneSec, 0.5)
          : // frame fallback: stagger by reveal order
            Math.max(0, Math.min(1, (frame / 30 - order * 0.45) / 0.5));
        const isFirst = i === 0;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 360,
              top: top + i * rowH,
              width: 1200,
              height: rowH * 0.78,
              backgroundColor: theme.colors.surface,
              borderRadius: 14,
              border: isFirst
                ? `3px solid ${theme.colors.accent}`
                : `1px solid ${theme.colors.secondary}55`,
              display: "flex",
              alignItems: "center",
              padding: "0 28px",
              gap: 24,
              opacity: p,
              transform: `translateY(${(1 - p) * 60}px)`,
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                backgroundColor: isFirst
                  ? theme.colors.accent
                  : theme.colors.background,
                border: isFirst
                  ? "none"
                  : `2px solid ${theme.colors.secondary}`,
                color: isFirst ? theme.colors.background : theme.colors.primary,
                fontFamily: theme.typography.subtitle.fontFamily,
                fontSize: 28,
                fontWeight: theme.typography.subtitle.fontWeight,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </div>
            <span
              style={{
                color: theme.colors.primary,
                fontFamily: theme.typography.body.fontFamily,
                fontSize: 34,
                flex: 1,
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {e.name}
            </span>
            {e.score !== undefined ? (
              <span
                style={{
                  color: isFirst ? theme.colors.accent : theme.colors.secondary,
                  fontFamily: theme.typography.code.fontFamily,
                  fontSize: 34,
                  fontWeight: theme.typography.subtitle.fontWeight,
                }}
              >
                {e.score}
              </span>
            ) : null}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
