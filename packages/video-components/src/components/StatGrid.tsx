import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface StatEntry {
  value: string;
  label: string;
  /** Optional sublabel — small, muted, one line. */
  hint?: string;
  /** Optional icon (single char) shown above the value. */
  icon?: string;
}

export interface StatGridProps {
  theme?: Theme;
  /** 1–6 entries. They auto-layout: 1 entry spans the row, 2 entries
   *  split the row, 3 or 4 use a 2xN grid, 5 or 6 use a 3x2 grid. */
  stats: StatEntry[];
  /** Optional caption shown under the grid. */
  caption?: string;
  /** v0.4.2 — `stat-${i}` scales each card in and drives its count-up. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** Split "85%" / "3.5x" / "12亿" into numeric head + surrounding text.
 *  Non-numeric values (∞, ✓) render as-is. Returns null on no numeric
 *  part — the caller falls back to plain-text rendering. */
function parseValue(raw: string): {
  prefix: string;
  num: number;
  suffix: string;
  decimals: number;
} | null {
  // Find the longest run of digits or digits-with-decimal.
  const m = raw.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const match = m[0];
  const num = parseFloat(match);
  if (!isFinite(num)) return null;
  const idx = m.index ?? raw.indexOf(match);
  const decimals = (match.split(".")[1] ?? "").length;
  return {
    prefix: raw.slice(0, idx),
    num,
    suffix: raw.slice(idx + match.length),
    decimals,
  };
}

/** Pick a 1, 2, 2x2, or 3x2 layout based on entry count. */
function layoutFor(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n <= 4) return { cols: 2, rows: 2 };
  return { cols: 3, rows: 2 };
}

const CARD_W = 460;
const CARD_H = 260;
const GAP_X = 40;
const GAP_Y = 40;

export const StatGrid: FC<StatGridProps> = ({
  theme = darkTechTheme,
  stats = [],
  caption,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  const visible = stats.slice(0, 6);
  const { cols, rows } = layoutFor(visible.length);
  const totalW = cols * CARD_W + (cols - 1) * GAP_X;
  const totalH = rows * CARD_H + (rows - 1) * GAP_Y;
  const startX = (1920 - totalW) / 2;
  const startY = (1080 - totalH) / 2 - 40; // nudged up to leave caption room

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
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${CARD_W}px)`,
          gridTemplateRows: `repeat(${rows}, ${CARD_H}px)`,
          columnGap: GAP_X,
          rowGap: GAP_Y,
          padding: 0,
        }}
      >
        {visible.map((stat, i) => {
          const statProgress = hasAnimations
            ? progressFor(animations, `stat-${i}`, sceneSec, 0.5)
            : fade(frame - i * 4, 18);
          // Count-up: the displayed number is the parsed `num` scaled
          // by statProgress, so each stat ticks up from 0 to its final.
          const parsed = parseValue(stat.value);
          const displayValue = parsed
            ? `${parsed.prefix}${parsed.num === 0 ? 0 : (parsed.num * statProgress).toFixed(parsed.decimals)}${parsed.suffix}`
            : stat.value;
          return (
            <div
              key={i}
              style={{
                width: CARD_W,
                height: CARD_H,
                backgroundColor: theme.colors.surface,
                border: `1.5px solid ${theme.colors.secondary}55`,
                borderRadius: 16,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: 24,
                gap: 8,
                boxShadow:
                  "0 8px 24px rgba(15, 23, 42, 0.06), 0 2px 6px rgba(15, 23, 42, 0.04)",
                opacity: statProgress,
                transform: `scale(${0.92 + 0.08 * statProgress})`,
                transformOrigin: "center",
              }}
            >
              {/* Optional icon — single character on a tinted circle. */}
              {stat.icon !== undefined ? (
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: `${theme.colors.accent}1F`,
                    border: `1.5px solid ${theme.colors.accent}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: theme.colors.accent,
                    fontWeight: 700,
                    fontSize: 22,
                    fontFamily: theme.typography.subtitle.fontFamily,
                  }}
                >
                  {stat.icon.toUpperCase()}
                </div>
              ) : null}
              {/* The big number — or fallback text if the value has no
                  numeric part (e.g. "∞"). */}
              <div
                style={{
                  fontSize: 80,
                  lineHeight: 1,
                  fontWeight: 700,
                  fontFamily: theme.typography.title.fontFamily,
                  color: theme.colors.accent,
                  textShadow: `0 2px 8px ${theme.colors.accent}22`,
                  fontVariantNumeric: "tabular-nums",
                  marginTop: 4,
                }}
              >
                {displayValue}
              </div>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 600,
                  color: theme.colors.primary,
                  fontFamily: theme.typography.subtitle.fontFamily,
                  textAlign: "center",
                }}
              >
                {stat.label}
              </div>
              {stat.hint !== undefined ? (
                <div
                  style={{
                    fontSize: 18,
                    color: theme.colors.secondary,
                    fontFamily: theme.typography.body.fontFamily,
                    textAlign: "center",
                  }}
                >
                  {stat.hint}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {caption !== undefined ? (
        <div
          style={{
            position: "absolute",
            bottom: 60,
            left: 0,
            right: 0,
            textAlign: "center",
            color: theme.colors.secondary,
            fontSize: 22,
            fontFamily: theme.typography.body.fontFamily,
          }}
        >
          {caption}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
