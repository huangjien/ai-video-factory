import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface ChecklistItem {
  text: string;
}

export interface ChecklistProps {
  theme?: Theme;
  items: ChecklistItem[];
  title?: string;
  /** v0.4.2 — `item-${i}` pops each check mark and fades its text in. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** Vertical checklist. Each check mark strokes on (SVG pathLength trick)
 *  before its text fades in — the "ticking off" beat per item. */
export const Checklist: FC<ChecklistProps> = ({
  theme = darkTechTheme,
  items = [],
  title,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  const shown = items.slice(0, 6);
  const rowH = 110;
  const top = 1080 / 2 - (shown.length * rowH) / 2;
  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      {title !== undefined ? (
        <h3
          style={{
            position: "absolute",
            top: Math.max(60, top - 130),
            width: "100%",
            textAlign: "center",
            color: theme.colors.primary,
            fontFamily: theme.typography.subtitle.fontFamily,
            fontSize: theme.typography.subtitle.fontSize,
            margin: 0,
          }}
        >
          {title}
        </h3>
      ) : null}
      {shown.map((it, i) => {
        const p = hasAnimations
          ? progressFor(animations, `item-${i}`, sceneSec, 0.4)
          : fade(frame - i * 8, 18);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 460,
              top: top + i * rowH,
              width: 1000,
              height: rowH * 0.8,
              display: "flex",
              alignItems: "center",
              gap: 28,
            }}
          >
            <svg width={56} height={56} viewBox="0 0 56 56" style={{ flexShrink: 0 }}>
              <circle
                cx={28}
                cy={28}
                r={24}
                fill="none"
                stroke={theme.colors.secondary}
                strokeWidth={3}
              />
              <polyline
                points="16,29 25,38 41,20"
                fill="none"
                stroke={theme.colors.accent}
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - p}
              />
            </svg>
            <span
              style={{
                color: theme.colors.primary,
                fontFamily: theme.typography.body.fontFamily,
                fontSize: 34,
                opacity: p,
              }}
            >
              {it.text}
            </span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
