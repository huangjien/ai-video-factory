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
          // Subscribe-shaped pill: full radius + accent fill + bold weight,
          // stands out against any dark theme. Play triangle is an inline
          // SVG so the icon renders identically across hosts (no font
          // fallback risk).
          <div
            style={{
              marginTop: 48,
              display: "inline-flex",
              alignItems: "center",
              gap: 14,
              padding: "18px 40px",
              backgroundColor: theme.colors.accent,
              color: theme.colors.surface,
              borderRadius: 999,
              fontSize: 32,
              fontWeight: 700,
              fontFamily: theme.typography.body.fontFamily,
              letterSpacing: 0.5,
              boxShadow: `0 6px 24px ${theme.colors.accent}55`,
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              style={{ flexShrink: 0 }}
            >
              <path d="M6 4 L20 12 L6 20 Z" />
            </svg>
            <span>{cta}</span>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
