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
  /** Optional small icon shown to the left of the bar. */
  icon?: string;
  /** Optional short description shown to the right of the value. */
  caption?: string;
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

const LABEL_X = 360;
const TRACK_X = 480;
const TRACK_W = 1120;

/** Horizontal bar chart. Each bar grows from a track to a filled value,
 *  with the value label sitting on the bar's leading tip. The chart is
 *  normalized against the largest bar so a chart of proportions and a
 *  chart of absolutes both read correctly. */
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
  const maxV = bars.reduce((m, b) => Math.max(m, b.value), 0);
  const safeMax = maxV > 0 ? maxV : 1;
  const rowH = 80;
  const headerH = title !== undefined ? 110 : 0;
  const innerTop =
    (1080 - (headerH + bars.length * rowH + (bars.length - 1) * 20)) / 2;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "transparent",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 1920 1080">
        <defs>
          <linearGradient id="bar-fill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={theme.colors.accent}
              stopOpacity="0.95"
            />
            <stop
              offset="100%"
              stopColor={theme.colors.accent}
              stopOpacity="0.55"
            />
          </linearGradient>
          <filter id="bar-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
            <feOffset dx="0" dy="2" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.18" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Title + subtitle underline. */}
        {title !== undefined ? (
          <g>
            <text
              x={960}
              y={innerTop + 36}
              fill={theme.colors.primary}
              fontSize={44}
              fontWeight={700}
              textAnchor="middle"
              fontFamily={theme.typography.subtitle.fontFamily}
            >
              {title}
            </text>
            <line
              x1={900}
              y1={innerTop + 60}
              x2={1020}
              y2={innerTop + 60}
              stroke={theme.colors.accent}
              strokeWidth={3}
              strokeLinecap="round"
            />
          </g>
        ) : null}

        {bars.map((bar, i) => {
          const rowY = innerTop + headerH + i * (rowH + 20);
          const barProgress = hasAnimations
            ? progressFor(animations, `bar-${i}`, sceneSec, 0.5)
            : fade(frame - i * 6, 18);
          // The fill width is normalized to the largest bar. The drawn
          // portion scales with `barProgress` so the bar grows in.
          const fullW = (bar.value / safeMax) * TRACK_W;
          const drawnW = fullW * barProgress;
          return (
            <g
              key={`bar-${i}`}
              transform={`translate(0, ${rowY})`}
              opacity={barProgress}
            >
              {/* Optional icon on the far left — a small accent circle. */}
              {bar.icon !== undefined ? (
                <g transform={`translate(${LABEL_X - 30}, 24)`}>
                  <circle
                    r={20}
                    fill={theme.colors.surface}
                    stroke={theme.colors.accent}
                    strokeWidth={2}
                  />
                  <text
                    x={0}
                    y={6}
                    fill={theme.colors.accent}
                    fontSize={18}
                    fontWeight={700}
                    textAnchor="middle"
                    fontFamily={theme.typography.subtitle.fontFamily}
                  >
                    {bar.icon.toUpperCase()}
                  </text>
                </g>
              ) : null}
              {/* Label on the far left. */}
              <text
                x={LABEL_X}
                y={32}
                fill={theme.colors.primary}
                fontSize={28}
                fontWeight={600}
                fontFamily={theme.typography.subtitle.fontFamily}
              >
                {bar.label}
              </text>
              {/* Track — the unfilled portion of the bar. */}
              <rect
                x={TRACK_X}
                y={10}
                width={TRACK_W}
                height={40}
                rx={20}
                fill={theme.colors.surface}
                opacity={0.5}
                stroke={theme.colors.secondary}
                strokeWidth={1}
              />
              {/* Filled portion — gradient + drop shadow. */}
              <rect
                x={TRACK_X}
                y={10}
                width={Math.max(drawnW, 4)}
                height={40}
                rx={20}
                fill="url(#bar-fill)"
                filter="url(#bar-shadow)"
              />
              {/* Leading edge — a small circle that gives the bar a clear
                  "tip" so the eye knows where it stopped. */}
              <circle
                cx={TRACK_X + Math.max(drawnW, 4)}
                cy={30}
                r={20}
                fill={theme.colors.surface}
                stroke={theme.colors.accent}
                strokeWidth={3}
              />
              {/* Value label — sits on the bar's tip. `display` overrides
                  the formatted number when present. */}
              <text
                x={TRACK_X + Math.max(drawnW, 4) + 32}
                y={36}
                fill={theme.colors.accent}
                fontSize={28}
                fontWeight={700}
                fontFamily={theme.typography.code.fontFamily}
              >
                {bar.display ?? formatValue(bar.value, maxV)}
              </text>
              {/* Caption / unit note (e.g. "of LLM calls"). */}
              {bar.caption !== undefined ? (
                <text
                  x={TRACK_X + Math.max(drawnW, 4) + 32}
                  y={62}
                  fill={theme.colors.secondary}
                  fontSize={18}
                  fontFamily={theme.typography.body.fontFamily}
                >
                  {bar.caption}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

/** Pick a sensible display for a raw numeric bar value when the caller
 *  didn't pass `display`. Relative to the max value: a value of 85 with
 *  max 100 reads as "85%", 3.5 with max 5 reads as "70%", a tiny count
 *  reads as-is. */
function formatValue(v: number, maxV: number): string {
  if (maxV > 0 && v > 0 && v < maxV && maxV >= 10)
    return `${Math.round((v / maxV) * 100)}%`;
  return String(v);
}
