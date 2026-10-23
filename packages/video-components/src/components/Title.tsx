import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { entrance, fadeOut } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";

export interface TitleProps {
  theme?: Theme;
  text: string;
  subtext?: string | undefined;
  /** Optional small kicker (e.g. "Chapter One", "Tutorial 03") rendered
   *  above the main title in uppercase tracking. */
  kicker?: string;
  /** Optional accent color override — a hex string used for the
   *  underline accent rule. Defaults to the theme's accent. */
  accent?: string;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

function letterOffset(
  i: number,
  total: number,
  enterT: number,
): { x: number; y: number; rot: number } {
  const stagger = i / Math.max(1, total - 1) - 0.5;
  const x = stagger * 80 * (1 - enterT);
  const y = -50 * (1 - enterT);
  const rot = stagger * 12 * (1 - enterT);
  return { x, y, rot };
}

export const Title: FC<TitleProps> = ({
  theme = darkTechTheme,
  text,
  subtext,
  kicker,
  accent,
  startFrame,
  durationInFrames,
  frame,
}) => {
  const enter = entrance(frame, 24, "up");
  const exit = fadeOut(frame, durationInFrames, 18);
  const opacity = enter.opacity * exit;
  const translateY = enter.translate;
  const scale = enter.scale;
  const underline = enter.scale;
  // A tiny continuous breath on the main title (1% scale oscillation)
  // makes the static "title card" feel alive without being distracting.
  const breath = 1 + Math.sin((frame / 96) * Math.PI * 2) * 0.01;
  const chars = [...text];
  const accentColor = accent ?? theme.colors.accent;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "transparent",
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div
        style={{
          transform: `translateY(${translateY}px) scale(${scale * breath})`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          maxWidth: 1600,
        }}
      >
        {/* Optional kicker — small uppercase label above the title.
            Fades in slightly later than the main text. */}
        {kicker !== undefined ? (
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: accentColor,
              fontFamily: theme.typography.subtitle.fontFamily,
              marginBottom: 24,
              opacity: Math.max(0, (enter.opacity - 0.2) / 0.8),
            }}
          >
            {kicker}
          </div>
        ) : null}
        <h1
          style={{
            color: theme.colors.primary,
            fontFamily: theme.typography.title.fontFamily,
            fontWeight: 700,
            fontSize: 96,
            margin: 0,
            marginBottom: 24,
            textShadow: `0 0 ${40 * enter.opacity}px ${accentColor}`,
            display: "flex",
          }}
        >
          {chars.map((c, i) => {
            const k = letterOffset(i, chars.length, enter.opacity);
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  whiteSpace: "pre",
                  transform: `translate(${k.x}px, ${k.y}px) rotate(${k.rot}deg) scale(${breath})`,
                }}
              >
                {c}
              </span>
            );
          })}
        </h1>
        {/* Accent underline — a small horizontal rule under the title
            that scales in with the entrance. */}
        <div
          style={{
            marginTop: 32,
            width: 240,
            height: 6,
            background: accentColor,
            transform: `scaleX(${underline})`,
            transformOrigin: "left",
            boxShadow: `0 0 ${12 * enter.opacity}px ${accentColor}`,
            borderRadius: 3,
          }}
        />
        {/* Subtext (optional) — slightly larger, muted, fades in after
            the title. */}
        {subtext !== undefined ? (
          <div
            style={{
              marginTop: 36,
              fontSize: 32,
              color: theme.colors.secondary,
              fontFamily: theme.typography.subtitle.fontFamily,
              fontWeight: 500,
              opacity: Math.max(0, (enter.opacity - 0.3) / 0.7),
              textAlign: "center",
              maxWidth: 1200,
            }}
          >
            {subtext}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
