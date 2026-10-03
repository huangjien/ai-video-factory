import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { scale } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface TimelineProps {
  theme?: Theme;
  events: { label: string; description?: string }[];
  /** v0.4.1 — scene-level timeline animations. Each event
   *  `target: "event-${label}"` scales up at its own start time. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

export const Timeline: FC<TimelineProps> = ({
  theme = darkTechTheme,
  events,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec =
    durationInFrames > 0
      ? frame * ((durationInFrames / 30) / durationInFrames)
      : frame / 30;
  const maxRight = 1800;
  const margin = 60;
  const span = maxRight - margin * 2;
  const step = events.length > 1 ? span / (events.length - 1) : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      <svg width="100%" height="100%" viewBox="0 0 1920 1080">
        <line
          x1={margin}
          y1={540}
          x2={maxRight}
          y2={540}
          stroke={theme.colors.secondary}
          strokeWidth={3}
        />
        {events.map((ev, i) => {
          const cx = margin + step * i;
          // Per-event animation when present; otherwise the legacy
          // sequential scale-up runs unchanged so older storyboards
          // still animate.
          const eventProgress = hasAnimations
            ? progressFor(animations, `event-${ev.label}`, sceneSec, 0.5)
            : Math.max(0, Math.min(1, frame / 30 - i * 0.5));
          const s = hasAnimations
            ? 0.5 + 0.5 * eventProgress
            : scale(frame + i * 5, 0.5);
          return (
            <g key={i} opacity={eventProgress}>
              <circle
                cx={cx}
                cy={540}
                r={16 * s}
                fill={theme.colors.accent}
              />
              <text
                x={cx}
                y={540 + 60}
                fill={theme.colors.primary}
                fontSize={28}
                textAnchor="middle"
                fontFamily={theme.typography.body.fontFamily}
              >
                {ev.label}
              </text>
              {ev.description !== undefined ? (
                <text
                  x={cx}
                  y={540 + 100}
                  fill={theme.colors.secondary}
                  fontSize={22}
                  textAnchor="middle"
                  fontFamily={theme.typography.body.fontFamily}
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
