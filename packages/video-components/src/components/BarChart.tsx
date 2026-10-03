import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface Bar {
  label: string;
  value: number;
  /** Original text form ("40%") — shown at the bar tip when present. */
  display?: string;
}

export interface BarChartProps {
  theme?: Theme;
  bars: Bar[];
  title?: string;
  /** v0.4.2 — `bar-${i}` grows each bar (type "draw"). */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const LABEL_X = 430;
const TRACK_W = 1180;

/** Horizontal bar chart. Bars grow with an easeOut from the shared
 *  per-element progress; values normalize against the largest bar so a
 *  chart of proportions and a chart of absolutes both read correctly. */
export const BarChart: FC<BarChartProps> = ({
  theme = darkTechTheme,
  bars = [],
  title,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  const shown = bars.slice(0, 6);
  const maxV = Math.max(1, ...shown.map((b) => b.value));
  const rowH = Math.min(130, 640 / Math.max(1, shown.length));
  const barH = rowH * 0.56;
  const top = shown.length > 0 ? 1080 / 2 - (shown.length * rowH) / 2 : 540;
  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      <svg width="100%" height="100%" viewBox="0 0 1920 1080">
        {title !== undefined ? (
          <text
            x={960}
            y={top - 60}
            fill={theme.colors.primary}
            fontSize={theme.typography.subtitle.fontSize}
            fontWeight={theme.typography.subtitle.fontWeight}
            textAnchor="middle"
            fontFamily={theme.typography.subtitle.fontFamily}
          >
            {title}
          </text>
        ) : null}
        {shown.map((b, i) => {
          const p = hasAnimations
            ? progressFor(animations, `bar-${i}`, sceneSec, 0.5)
            : fade(frame - i * 6, 25);
          const w = (b.value / maxV) * TRACK_W * p;
          const y = top + i * rowH;
          return (
            <g key={i} opacity={Math.max(0.05, p)}>
              <text
                x={LABEL_X - 24}
                y={y + barH / 2}
                fill={theme.colors.primary}
                fontSize={30}
                textAnchor="end"
                dominantBaseline="middle"
                fontFamily={theme.typography.body.fontFamily}
              >
                {b.label}
              </text>
              <rect
                x={LABEL_X}
                y={y}
                width={Math.max(0, w)}
                height={barH}
                rx={10}
                fill={theme.colors.accent}
              />
              <text
                x={LABEL_X + Math.max(0, w) + 18}
                y={y + barH / 2}
                fill={theme.colors.secondary}
                fontSize={28}
                dominantBaseline="middle"
                fontFamily={theme.typography.code.fontFamily}
              >
                {b.display ?? String(b.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
