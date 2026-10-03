import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade, scale } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";

export interface EndCardProps {
  theme?: Theme;
  title: string;
  subtitle?: string;
  cta?: string;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

export const EndCard: FC<EndCardProps> = ({ title, subtitle, cta, frame, theme = darkTechTheme }) => {
  const opacity = fade(frame);
  const s = scale(frame, 0.92);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.background,
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div style={{ textAlign: "center", transform: `scale(${s})` }}>
        <h1
          style={{
            color: theme.colors.primary,
            fontFamily: theme.typography.title.fontFamily,
            fontWeight: theme.typography.title.fontWeight,
            fontSize: 96,
            margin: 0,
          }}
        >
          {title}
        </h1>
        {subtitle !== undefined ? (
          <p
            style={{
              color: theme.colors.secondary,
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
              backgroundColor: theme.colors.accent,
              color: theme.colors.background,
              borderRadius: 8,
              fontSize: 32,
              fontFamily: theme.typography.body.fontFamily,
            }}
          >
            {cta}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
