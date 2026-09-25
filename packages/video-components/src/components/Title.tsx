import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { entrance, fadeOut } from "../animations.js";
import { darkTechTheme } from "../theme.js";

export interface TitleProps {
  text: string;
  subtext?: string | undefined;
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
  text,
  subtext,
  startFrame,
  durationInFrames,
  frame,
}) => {
  const enter = entrance(frame, 24, "up");
  const underline = entrance(frame, 36, "left");
  const exit = fadeOut(frame, durationInFrames, 18);
  const opacity = enter.opacity * exit;
  const translateY = enter.translate;
  const scale = enter.scale;
  const underlineScale = underline.scale;
  const breath = 1 + Math.sin((frame / 96) * Math.PI * 2) * 0.015;
  const chars = [...text];
  return (
    <AbsoluteFill
      style={{
        backgroundColor: darkTechTheme.colors.background,
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div
        style={{
          transform: `translateY(${translateY}px) scale(${scale})`,
          transformOrigin: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <h1
          style={{
            color: darkTechTheme.colors.primary,
            fontFamily: darkTechTheme.typography.title.fontFamily,
            fontWeight: 700,
            fontSize: 96,
            margin: 0,
            marginBottom: 24,
            opacity,
            display: "flex",
            textShadow: `0 0 ${40 * enter.opacity}px ${darkTechTheme.colors.accent}`,
          }}
        >
          {chars.map((c, i) => {
            const k = letterOffset(i, chars.length, enter.opacity);
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  transform: `translate(${k.x}px, ${k.y}px) rotate(${k.rot}deg) scale(${breath})`,
                }}
              >
                {c}
              </span>
            );
          })}
        </h1>
        {subtext !== undefined ? (
          <p
            style={{
              color: darkTechTheme.colors.secondary,
              fontSize: 36,
              margin: 0,
              opacity: Math.max(0, enter.opacity - 0.3),
            }}
          >
            {subtext}
          </p>
        ) : null}
        <div
          style={{
            marginTop: 32,
            width: 240,
            height: 6,
            backgroundColor: darkTechTheme.colors.accent,
            transform: `scaleX(${underlineScale})`,
            transformOrigin: "left",
            boxShadow: `0 0 ${12 * enter.opacity}px ${darkTechTheme.colors.accent}`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
