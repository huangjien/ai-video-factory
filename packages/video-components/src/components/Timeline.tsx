import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { scale } from "../animations.js";
import { darkTechTheme } from "../theme.js";

export interface TimelineProps {
  events: { label: string; description?: string }[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

export const Timeline: FC<TimelineProps> = ({ events, frame }) => {
  const maxRight = 1800;
  const margin = 60;
  const span = maxRight - margin * 2;
  const step = events.length > 1 ? span / (events.length - 1) : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: darkTechTheme.colors.background }}>
      <svg width="100%" height="100%" viewBox="0 0 1920 1080">
        <line
          x1={margin}
          y1={540}
          x2={maxRight}
          y2={540}
          stroke={darkTechTheme.colors.secondary}
          strokeWidth={3}
        />
        {events.map((ev, i) => {
          const cx = margin + step * i;
          const s = scale(frame + i * 5, 0.5);
          const opacity = Math.max(0, Math.min(1, frame / 30 - i * 0.5));
          return (
            <g key={i} opacity={opacity}>
              <circle
                cx={cx}
                cy={540}
                r={16 * s}
                fill={darkTechTheme.colors.accent}
              />
              <text
                x={cx}
                y={540 + 60}
                fill={darkTechTheme.colors.primary}
                fontSize={28}
                textAnchor="middle"
                fontFamily={darkTechTheme.typography.body.fontFamily}
              >
                {ev.label}
              </text>
              {ev.description !== undefined ? (
                <text
                  x={cx}
                  y={540 + 100}
                  fill={darkTechTheme.colors.secondary}
                  fontSize={22}
                  textAnchor="middle"
                  fontFamily={darkTechTheme.typography.body.fontFamily}
                >
                  {ev.description}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
