import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { slide } from "../animations.js";
import { darkTechTheme } from "../theme.js";

export interface ComparisonProps {
  left: { title: string; items: string[] };
  right: { title: string; items: string[] };
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const Card: FC<{
  title: string;
  items: string[];
  x: number;
  slideTranslate: number;
}> = ({ title, items, x, slideTranslate }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: 200,
      width: 700,
      transform: `translateX(${slideTranslate}px)`,
      backgroundColor: darkTechTheme.colors.surface,
      border: `2px solid ${darkTechTheme.colors.accent}`,
      borderRadius: 16,
      padding: 32,
    }}
  >
    <h3
      style={{
        color: darkTechTheme.colors.primary,
        fontFamily: darkTechTheme.typography.subtitle.fontFamily,
        fontSize: darkTechTheme.typography.subtitle.fontSize,
        margin: 0,
      }}
    >
      {title}
    </h3>
    <ul style={{ color: darkTechTheme.colors.secondary, fontSize: 28, lineHeight: 1.6 }}>
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  </div>
);

export const Comparison: FC<ComparisonProps> = ({ left, right, frame }) => {
  const leftSlide = slide(frame, "left", 200);
  const rightSlide = slide(frame, "right", 200);
  return (
    <AbsoluteFill
      style={{ backgroundColor: darkTechTheme.colors.background }}
    >
      <Card title={left.title} items={left.items} x={100} slideTranslate={leftSlide.translate} />
      <Card title={right.title} items={right.items} x={1120} slideTranslate={rightSlide.translate} />
    </AbsoluteFill>
  );
};
