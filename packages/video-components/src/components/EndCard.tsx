import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade, scale } from "../animations.js";
import { darkTechTheme } from "../theme.js";

export interface EndCardProps {
  title: string;
  subtitle?: string;
  cta?: string;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

export const EndCard: FC<EndCardProps> = ({ title, subtitle, cta, frame }) => {
  const opacity = fade(frame);
  const s = scale(frame, 0.92);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: darkTechTheme.colors.background,
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div style={{ textAlign: "center", transform: `scale(${s})` }}>
        <h1
          style={{
            color: darkTechTheme.colors.primary,
            fontFamily: darkTechTheme.typography.title.fontFamily,
            fontWeight: darkTechTheme.typography.title.fontWeight,
            fontSize: 96,
            margin: 0,
          }}
        >
          {title}
        </h1>
        {subtitle !== undefined ? (
          <p
            style={{
              color: darkTechTheme.colors.secondary,
              fontSize: 40,
              marginTop: 16,
            }}
          >
            {subtitle}
          </p>
        ) : null}
        {cta !== undefined ? (
          <div
            style={{
              marginTop: 48,
              display: "inline-block",
              padding: "16px 32px",
              backgroundColor: darkTechTheme.colors.accent,
              color: darkTechTheme.colors.background,
              borderRadius: 8,
              fontSize: 32,
              fontFamily: darkTechTheme.typography.body.fontFamily,
            }}
          >
            {cta}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
