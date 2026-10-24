import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface LeaderboardEntry {
  name: string;
  score?: string;
  /** Optional sublabel rendered under the name (role / category). */
  subtitle?: string;
  /** Optional rank accent color override; otherwise the row picks
   *  a color by its index (gold / silver / bronze / muted). */
  color?: string;
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

const ROW_W = 1280;
const ROW_H = 96;
const ROW_GAP = 12;

/** Ranked list, 1st place on top with an accent badge and border. Rows
 *  rise in from below; the emitter (and the frame fallback) reveals
 *  them from the bottom of the table upward for a countdown feel. */
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
  const totalH = entries.length * ROW_H + (entries.length - 1) * ROW_GAP;
  const startY = (1080 - totalH) / 2 - 20;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "transparent",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: title !== undefined ? 24 : 0,
        }}
      >
        {title !== undefined ? (
          <div
            style={{
              fontSize: 44,
              fontWeight: 700,
              color: theme.colors.primary,
              fontFamily: theme.typography.subtitle.fontFamily,
              marginBottom: 12,
            }}
          >
            {title}
          </div>
        ) : null}
        {entries.map((entry, i) => {
          const rank = i + 1;
          // Bottom-up reveal: rank 0 (best) shows last so the audience
          // sees the count build toward a winner.
          const order = entries.length - 1 - i;
          const rowProgress = hasAnimations
            ? progressFor(animations, `rank-${i}`, sceneSec, 0.5)
            : Math.max(0, Math.min(1, (frame - order * 6) / 24));
          // Default palette: gold / silver / bronze / muted-accent.
          const palette = ["#D4A24A", "#A3A8B0", "#B97A3E"];
          const accent = entry.color ?? palette[i] ?? theme.colors.accent;
          // Top 3 get a stronger treatment: bigger rank chip,
          // subtle accent strip on the left.
          const isPodium = i < 3;
          return (
            <div
              key={rank}
              style={{
                width: ROW_W,
                height: ROW_H,
                display: "flex",
                alignItems: "stretch",
                borderRadius: 12,
                backgroundColor: isPodium
                  ? `${accent}14`
                  : theme.colors.surface,
                border: `1.5px solid ${isPodium ? accent : theme.colors.secondary}33`,
                boxShadow: isPodium
                  ? `0 8px 24px ${accent}22, 0 2px 6px ${accent}11`
                  : "0 4px 10px rgba(15, 23, 42, 0.04)",
                opacity: rowProgress,
                transform: `translateX(${(1 - rowProgress) * 60}px)`,
                overflow: "hidden",
              }}
            >
              {/* Accent strip on the left of the row — wider + more
                  saturated for top 3, thin for the rest. */}
              <div
                style={{
                  width: isPodium ? 6 : 3,
                  background: accent,
                  borderRadius: "12px 0 0 12px",
                }}
              />
              {/* Rank chip — a small accent circle with the rank number.
                  Podium rows get a slightly larger, accent-filled chip. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: isPodium ? 56 : 44,
                  height: isPodium ? 56 : 44,
                  borderRadius: "50%",
                  marginLeft: 18,
                  alignSelf: "center",
                  backgroundColor: isPodium ? accent : theme.colors.background,
                  color: isPodium ? "#FFFFFF" : theme.colors.primary,
                  border: isPodium
                    ? "none"
                    : `1.5px solid ${theme.colors.secondary}66`,
                  fontSize: isPodium ? 26 : 22,
                  fontWeight: 700,
                  fontFamily: theme.typography.code.fontFamily,
                }}
              >
                {rank}
              </div>
              {/* Name + optional subtitle. */}
              <div
                style={{
                  flex: 1,
                  padding: "0 18px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    fontSize: isPodium ? 30 : 24,
                    fontWeight: isPodium ? 700 : 500,
                    color: theme.colors.primary,
                    fontFamily: theme.typography.subtitle.fontFamily,
                  }}
                >
                  {entry.name}
                </div>
                {entry.subtitle !== undefined ? (
                  <div
                    style={{
                      fontSize: 18,
                      color: theme.colors.secondary,
                      fontFamily: theme.typography.body.fontFamily,
                    }}
                  >
                    {entry.subtitle}
                  </div>
                ) : null}
              </div>
              {/* Score (right-aligned). */}
              {entry.score !== undefined ? (
                <div
                  style={{
                    padding: "0 28px",
                    display: "flex",
                    alignItems: "center",
                    color: isPodium ? accent : theme.colors.primary,
                    fontSize: isPodium ? 36 : 28,
                    fontWeight: 700,
                    fontFamily: theme.typography.code.fontFamily,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {entry.score}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
