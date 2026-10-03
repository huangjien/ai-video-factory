import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { slide } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface ComparisonProps {
  theme?: Theme;
  left: { title: string; items: string[] };
  right: { title: string; items: string[] };
  /** v0.4.1 — scene-level timeline animations. Card slides and per-
   *  item reveals are driven by `target: "__left__" / "__right__" /
   *  "left-item-${i}" / "right-item-${i}"`. When absent, falls back to
   *  the legacy synchronous slide-in. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const Card: FC<{
  title: string;
  items: string[];
  x: number;
  slideTranslate: number;
  opacity: number;
  /** Per-item progress 0..1; items with progress=0 are hidden. */
  itemProgress?: number[];
}> = ({ title, items, x, slideTranslate, opacity, itemProgress }, theme = darkTechTheme ) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: 200,
      width: 700,
      transform: `translateX(${slideTranslate}px)`,
      opacity,
      backgroundColor: theme.colors.surface,
      border: `2px solid ${theme.colors.accent}`,
      borderRadius: 16,
      padding: 32,
    }}
  >
    <h3
      style={{
        color: theme.colors.primary,
        fontFamily: theme.typography.subtitle.fontFamily,
        fontSize: theme.typography.subtitle.fontSize,
        margin: 0,
      }}
    >
      {title}
    </h3>
    <ul
      style={{
        color: theme.colors.secondary,
        fontSize: 28,
        lineHeight: 1.6,
      }}
    >
      {items.map((it, i) => {
        const ip = itemProgress?.[i];
        return (
          <li
            key={i}
            style={{
              opacity: ip === undefined ? 1 : Math.max(0, Math.min(1, ip)),
            }}
          >
            {it}
          </li>
        );
      })}
    </ul>
  </div>
);

export const Comparison: FC<ComparisonProps> = ({
  theme = darkTechTheme,
  left,
  right,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec =
    durationInFrames > 0
      ? frame * ((durationInFrames / 30) / durationInFrames)
      : frame / 30;
  const leftSlide = slide(frame, "left", 200);
  const rightSlide = slide(frame, "right", 200);
  const leftProgress = hasAnimations
    ? progressFor(animations, "__left__", sceneSec, 0.5)
    : 1;
  const rightProgress = hasAnimations
    ? progressFor(animations, "__right__", sceneSec, 0.5)
    : 1;
  const leftItemProgress = left.items.map((_, i) =>
    hasAnimations
      ? progressFor(animations, `left-item-${i}`, sceneSec, 0.4)
      : 1,
  );
  const rightItemProgress = right.items.map((_, i) =>
    hasAnimations
      ? progressFor(animations, `right-item-${i}`, sceneSec, 0.4)
      : 1,
  );
  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      <Card
        title={left.title}
        items={left.items}
        x={100}
        slideTranslate={hasAnimations ? (1 - leftProgress) * -200 : leftSlide.translate}
        opacity={hasAnimations ? leftProgress : 1}
        itemProgress={leftItemProgress}
      />
      <Card
        title={right.title}
        items={right.items}
        x={1120}
        slideTranslate={hasAnimations ? (rightProgress - 1) * 200 : rightSlide.translate}
        opacity={hasAnimations ? rightProgress : 1}
        itemProgress={rightItemProgress}
      />
    </AbsoluteFill>
  );
};
