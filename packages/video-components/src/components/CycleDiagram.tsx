import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface CycleDiagramProps {
  theme?: Theme;
  /** Loop stages in rotation order, first stage at 12 o'clock. */
  stages: string[];
  /** Text in the ring's center (usually the caption). */
  title?: string;
  /** v0.4.2 — `__ring__` draws the dashed orbit, `stage-${i}` lights each
   *  node in sequence. The ring's slow rotation is frame-driven and needs
   *  no animation entry. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const CX = 960;
const CY = 560;
const R = 330;

/** Circular process loop. Stage nodes sit on a slowly rotating dashed
 *  orbit (conveys the "loop never stops" feel) and light up in sequence.
 *  Pure frame math — deterministic across renders. */
export const CycleDiagram: FC<CycleDiagramProps> = ({
  theme = darkTechTheme,
  stages = [],
  title,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  const shown = stages.slice(0, 8);
  const n = shown.length;
  const posAt = (i: number): [number, number] => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, n);
    return [CX + R * Math.cos(angle), CY + R * Math.sin(angle)];
  };
  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      <svg width="100%" height="100%" viewBox="0 0 1920 1080">
        <g
          transform={`rotate(${(frame * 4) % 360} ${CX} ${CY})`}
          opacity={hasAnimations ? 1 : fade(frame, 30)}
        >
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke={theme.colors.secondary}
            strokeWidth={3}
            strokeDasharray="14 20"
          />
        </g>
        {title !== undefined ? (
          <text
            x={CX}
            y={CY}
            fill={theme.colors.primary}
            fontSize={40}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily={theme.typography.subtitle.fontFamily}
          >
            {title}
          </text>
        ) : null}
        {shown.map((stage, i) => {
          const p = hasAnimations
            ? progressFor(animations, `stage-${i}`, sceneSec, 0.4)
            : fade(frame - i * 8, 18);
          const [x, y] = posAt(i);
          return (
            <g key={i} opacity={p}>
              <circle
                cx={x}
                cy={y}
                r={46 + 10 * p}
                fill={theme.colors.surface}
                stroke={theme.colors.accent}
                strokeWidth={3}
              />
              <text
                x={x}
                y={y}
                fill={theme.colors.primary}
                fontSize={stage.length > 6 ? 22 : 26}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily={theme.typography.body.fontFamily}
              >
                {stage.length > 8 ? `${stage.slice(0, 7)}…` : stage}
              </text>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
