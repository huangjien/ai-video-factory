import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface PyramidDiagramProps {
  theme?: Theme;
  /** Levels top-first: `levels[0]` is the pyramid's apex. Rendering is
   *  bottom-up (foundation lands first). */
  levels: string[];
  /** v0.4.2 — `level-${i}` fades each trapezoid in, bottom-up. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const TOP_W = 260;
const BASE_W = 1400;
const TOP_Y = 220;
const BASE_Y = 920;

/** Layered pyramid of stacked trapezoids. Widths interpolate linearly
 *  from apex to base; levels rise from the foundation up. */
export const PyramidDiagram: FC<PyramidDiagramProps> = ({
  theme = darkTechTheme,
  levels = [],
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  const shown = levels.slice(0, 6);
  const n = shown.length;
  const levelH = (BASE_Y - TOP_Y) / Math.max(1, n);
  const widthAt = (k: number): number =>
    TOP_W + ((BASE_W - TOP_W) * k) / Math.max(1, n);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.background,
        justifyContent: "center",
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 1920 1080">
        {shown.map((label, i) => {
          const kTop = i;
          const kBot = i + 1;
          const yTop = TOP_Y + kTop * levelH;
          const yBot = TOP_Y + kBot * levelH;
          const wTop = widthAt(kTop);
          const wBot = widthAt(kBot);
          const cx = 960;
          // Bottom-up entrance: the deepest level animates first.
          const order = n - 1 - i;
          const p = hasAnimations
            ? progressFor(animations, `level-${i}`, sceneSec, 0.5)
            : fade(frame - order * 8, 20);
          const fillOpacity = 0.22 + 0.5 * (1 - i / Math.max(1, n - 1));
          return (
            <g key={i} opacity={p}>
              <polygon
                points={[
                  `${cx - wTop / 2},${yTop}`,
                  `${cx + wTop / 2},${yTop}`,
                  `${cx + wBot / 2},${yBot}`,
                  `${cx - wBot / 2},${yBot}`,
                ].join(" ")}
                fill={theme.colors.accent}
                fillOpacity={fillOpacity}
                stroke={theme.colors.accent}
                strokeWidth={2}
              />
              <text
                x={cx}
                y={(yTop + yBot) / 2}
                fill={theme.colors.primary}
                fontSize={Math.min(34, levelH * 0.42)}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily={theme.typography.body.fontFamily}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
