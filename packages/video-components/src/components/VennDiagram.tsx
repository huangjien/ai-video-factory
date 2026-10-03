import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface VennDiagramProps {
  theme?: Theme;
  /** 1–3 set names; extra sets are dropped by the builder. */
  sets: string[];
  /** Optional label rendered in the shared intersection. */
  center?: string;
  /** v0.4.2 — `set-${i}` fades each circle in. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const SET_COLORS = ["accent", "warning", "success"] as const;

/** Overlapping translucent circles (2-set or classic 3-set). Each set
 *  uses a different theme pop color at low fill opacity so the overlap
 *  region blends visibly. */
export const VennDiagram: FC<VennDiagramProps> = ({
  theme = darkTechTheme,
  sets = [],
  center,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  const shown = sets.slice(0, 3);
  const n = shown.length;
  const R = 300;
  const centers: [number, number][] =
    n === 1
      ? [[960, 540]]
      : n === 2
        ? [
            [770, 540],
            [1150, 540],
          ]
        : [
            [790, 440],
            [1130, 440],
            [960, 740],
          ];
  // Label sits away from the overlap, toward the circle's outer edge.
  const labelOffset: [number, number][] =
    n === 1
      ? [[0, 0]]
      : n === 2
        ? [
            [-150, 0],
            [150, 0],
          ]
        : [
            [-110, -110],
            [110, -110],
            [0, 150],
          ];
  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.background,
        justifyContent: "center",
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 1920 1080">
        {shown.map((label, i) => {
          const p = hasAnimations
            ? progressFor(animations, `set-${i}`, sceneSec, 0.5)
            : fade(frame - i * 8, 20);
          const colorKey = SET_COLORS[i % SET_COLORS.length] ?? "accent";
          const color = theme.colors[colorKey];
          const [cx, cy] = centers[i] ?? [960, 540];
          const [lx, ly] = labelOffset[i] ?? [0, 0];
          return (
            <g key={i} opacity={p}>
              <circle
                cx={cx}
                cy={cy}
                r={R}
                fill={color}
                fillOpacity={0.32 * p}
                stroke={color}
                strokeWidth={3}
              />
              <text
                x={cx + lx}
                y={cy + ly}
                fill={theme.colors.primary}
                fontSize={38}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily={theme.typography.subtitle.fontFamily}
              >
                {label}
              </text>
            </g>
          );
        })}
        {center !== undefined && n >= 2 ? (
          <text
            x={n === 2 ? 960 : 960}
            y={n === 2 ? 540 : 560}
            fill={theme.colors.primary}
            fontSize={34}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily={theme.typography.body.fontFamily}
          >
            {center}
          </text>
        ) : null}
      </svg>
    </AbsoluteFill>
  );
};
