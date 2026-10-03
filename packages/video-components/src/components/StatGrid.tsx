import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, easeOut, type TimelineAnim } from "./timelineTiming.js";

export interface StatEntry {
  value: string;
  label: string;
}

export interface StatGridProps {
  theme?: Theme;
  stats: StatEntry[];
  caption?: string;
  /** v0.4.2 — `stat-${i}` scales each card in and drives its count-up. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** Split "85%" / "3.5x" / "12亿" into numeric head + surrounding text.
 *  Non-numeric values (∞, ✓) render as-is with a plain fade. */
function parseValue(raw: string): {
  prefix: string;
  num: number;
  suffix: string;
  decimals: number;
} | null {
  const m = raw.match(/^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m || m[2] === undefined) return null;
  return {
    prefix: m[1] ?? "",
    num: parseFloat(m[2].replace(/,/g, "")),
    suffix: m[3] ?? "",
    decimals: m[2].includes(".") ? 1 : 0,
  };
}

const colsFor = (n: number): number =>
  n <= 1 ? 1 : n === 3 || n > 4 ? 3 : 2;

/** Big-number cards with a count-up entrance. The number interpolates
 *  from 0 to its final value as the card's progress completes, so the
 *  figure "lands" instead of popping in. */
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
  const shown = stats.slice(0, 6);
  const cols = colsFor(shown.length);
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
          display: "flex",
          flexWrap: "wrap",
          gap: 40,
          justifyContent: "center",
          width: 1640,
        }}
      >
        {shown.map((s, i) => {
          const p = hasAnimations
            ? progressFor(animations, `stat-${i}`, sceneSec, 0.5)
            : fade(frame - i * 8, 20);
          const parsed = parseValue(s.value);
          const display = parsed
            ? `${parsed.prefix}${
                parsed.decimals > 0
                  ? (parsed.num * easeOut(p)).toFixed(parsed.decimals)
                  : String(Math.round(parsed.num * easeOut(p)))
              }${parsed.suffix}`
            : s.value;
          return (
            <div
              key={i}
              style={{
                width: cols === 1 ? 900 : cols === 2 ? 760 : 500,
                backgroundColor: theme.colors.surface,
                borderTop: `8px solid ${theme.colors.accent}`,
                borderRadius: 16,
                padding: "48px 32px",
                textAlign: "center",
                opacity: p,
                transform: `scale(${0.9 + 0.1 * p})`,
              }}
            >
              <div
                style={{
                  color: theme.colors.accent,
                  fontFamily: theme.typography.title.fontFamily,
                  fontSize: 116,
                  fontWeight: theme.typography.title.fontWeight,
                  lineHeight: 1.1,
                }}
              >
                {display}
              </div>
              <div
                style={{
                  color: theme.colors.secondary,
                  fontFamily: theme.typography.body.fontFamily,
                  fontSize: 32,
                  marginTop: 20,
                }}
              >
                {s.label}
              </div>
            </div>
          );
        })}
      </div>
      {caption !== undefined ? (
        <p
          style={{
            color: theme.colors.secondary,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 30,
            marginTop: 48,
          }}
        >
          {caption}
        </p>
      ) : null}
    </AbsoluteFill>
  );
};
