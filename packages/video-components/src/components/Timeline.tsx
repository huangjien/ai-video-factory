import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface TimelineEvent {
  label: string;
  description?: string;
  /** ISO-style year, or any string (`"2022"`, `"Q1"`, …) shown under
   *  the milestone. Falls back to a numbered index if omitted. */
  date?: string;
  /** Marks this event as the current/featured one. Highlights its
   *  card, the milestone dot, and a "you are here" flag above. */
  featured?: boolean;
}

export interface TimelineProps {
  theme?: Theme;
  events: TimelineEvent[] | { label: string; description?: string }[];
  /** v0.4.1 — scene-level timeline animations. Each event
   *  `target: "event-${label}"` scales up at its own start time. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** Width of the timeline strip. Sized to leave a generous safe margin
 *  on either side so a long date label or a multi-line description
 *  doesn't clip. */
const STRIP_LEFT = 240;
const STRIP_RIGHT = 1680;
const AXIS_Y = 640;
const CARD_W = 320;
const CARD_H = 130;

export const Timeline: FC<TimelineProps> = ({
  theme = darkTechTheme,
  events,
  animations,
  frame,
  durationInFrames,
}) => {
  // Normalize legacy event shape to the new typed shape so the two
  // back-compat callers keep working.
  const typed: TimelineEvent[] = events.map((e) => {
    if ("date" in e || "featured" in e) return e as TimelineEvent;
    const out: TimelineEvent = { label: e.label };
    if (e.description !== undefined) out.description = e.description;
    return out;
  });

  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec =
    durationInFrames > 0
      ? frame * (durationInFrames / 30 / durationInFrames)
      : frame / 30;
  const span = STRIP_RIGHT - STRIP_LEFT;
  const step = typed.length > 1 ? span / (typed.length - 1) : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <svg width="100%" height="100%" viewBox="0 0 1920 1080">
        <defs>
          <filter
            id="timeline-card-shadow"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feGaussianBlur in="SourceAlpha" stdDeviation="4" />
            <feOffset dx="0" dy="3" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.15" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Title strip — a thin baseline + a small heading tag. */}
        <line
          x1={STRIP_LEFT - 40}
          y1={AXIS_Y}
          x2={STRIP_RIGHT + 40}
          y2={AXIS_Y}
          stroke={theme.colors.secondary}
          strokeWidth={3}
          strokeLinecap="round"
          opacity={0.55}
        />

        {typed.map((ev, i) => {
          const cx = typed.length > 1 ? STRIP_LEFT + step * i : (STRIP_LEFT + STRIP_RIGHT) / 2;
          // Per-event animation: scale-up. Without it, all events render
          // at full opacity and the global fade handles entrance.
          const eventProgress = hasAnimations
            ? progressFor(animations, `event-${ev.label}`, sceneSec, 0.5)
            : 1;
          const dateLabel = ev.date ?? String(i + 1);
          const featured = ev.featured === true;
          // Cards alternate above / below the axis. i=0 always goes
          // above (no alternating flip on the first card), so the title
          // strip at the top isn't crowded.
          const above = i % 2 === 0;
          const cardY = above ? AXIS_Y - CARD_H - 60 : AXIS_Y + 60;
          return (
            <g
              key={`event-${i}`}
              opacity={hasAnimations ? eventProgress : 1}
              transform={`translate(${cx}, ${AXIS_Y}) scale(${0.85 + 0.15 * eventProgress})`}
              style={{ transformOrigin: "center" }}
              filter="url(#timeline-card-shadow)"
            >
              {/* Connector — slim line from the milestone dot to the
                  card, with a small arrowhead pointing at the card. */}
              {above ? (
                <>
                  <line
                    x1={0}
                    y1={0}
                    x2={0}
                    y2={-(60 - 4)}
                    stroke={theme.colors.secondary}
                    strokeWidth={2}
                    strokeDasharray="2 4"
                    opacity={0.6}
                  />
                  <polygon
                    points={`-5,${-(60 - 4) - 6} 5,${-(60 - 4) - 6} 0,${-(60 - 4)}`}
                    fill={theme.colors.secondary}
                    opacity={0.6}
                  />
                </>
              ) : (
                <>
                  <line
                    x1={0}
                    y1={0}
                    x2={0}
                    y2={60 - 4}
                    stroke={theme.colors.secondary}
                    strokeWidth={2}
                    strokeDasharray="2 4"
                    opacity={0.6}
                  />
                  <polygon
                    points={`-5,${60 - 4 + 6} 5,${60 - 4 + 6} 0,${60 - 4}`}
                    fill={theme.colors.secondary}
                    opacity={0.6}
                  />
                </>
              )}

              {/* Card — offset to the side so the dot stays centered on
                  the axis. The card sits at half its width to the left
                  so the connector hits the card edge, not the middle. */}
              <g
                transform={`translate(${-CARD_W / 2}, ${above ? cardY - AXIS_Y : cardY - AXIS_Y})`}
              >
                <rect
                  width={CARD_W}
                  height={CARD_H}
                  rx={12}
                  fill={featured ? theme.colors.accent : theme.colors.surface}
                  stroke={featured ? theme.colors.accent : theme.colors.secondary}
                  strokeWidth={featured ? 0 : 1.5}
                  opacity={featured ? 0.10 : 1}
                />
                <text
                  x={16}
                  y={32}
                  fill={theme.colors.primary}
                  fontSize={22}
                  fontWeight={700}
                  fontFamily={theme.typography.subtitle.fontFamily}
                >
                  {ev.label}
                </text>
                {ev.description !== undefined ? (
                  <foreignObject x={16} y={50} width={CARD_W - 32} height={CARD_H - 60}>
                    <div
                      style={{
                        color: theme.colors.secondary,
                        fontSize: 16,
                        lineHeight: 1.35,
                        fontFamily: theme.typography.body.fontFamily,
                      }}
                    >
                      {ev.description}
                    </div>
                  </foreignObject>
                ) : null}
              </g>

              {/* Milestone dot on the axis. Featured = larger + accent
                  ring + pulse halo. */}
              <circle
                cx={0}
                cy={0}
                r={featured ? 18 : 12}
                fill={theme.colors.background}
                stroke={featured ? theme.colors.accent : theme.colors.secondary}
                strokeWidth={featured ? 5 : 3}
              />
              {featured ? (
                <circle
                  cx={0}
                  cy={0}
                  r={28}
                  fill="none"
                  stroke={theme.colors.accent}
                  strokeWidth={1.5}
                  opacity={0.45}
                />
              ) : null}

              {/* Date label below the axis. Always under the dot so
                  the date+event pairing is unambiguous. */}
              <g transform={`translate(0, ${(above ? 38 : -38) * (above ? 1 : -1)})`}>
                <rect
                  x={-50}
                  y={-14}
                  width={100}
                  height={28}
                  rx={14}
                  fill={featured ? theme.colors.accent : theme.colors.background}
                  stroke={theme.colors.secondary}
                  strokeWidth={1}
                />
                <text
                  x={0}
                  y={6}
                  fill={featured ? "#FFFFFF" : theme.colors.primary}
                  fontSize={16}
                  fontWeight={600}
                  textAnchor="middle"
                  fontFamily={theme.typography.code.fontFamily}
                >
                  {dateLabel}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
