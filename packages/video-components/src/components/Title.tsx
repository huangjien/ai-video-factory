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
            fontWeight: darkTechTheme.typography.title.fontWeight,
            fontSize: darkTechTheme.typography.title.fontSize,
            margin: 0,
            textShadow: `0 0 ${40 * enter.opacity}px ${darkTechTheme.colors.accent}`,
          }}
        >
          {text}
        </h1>
        {subtext !== undefined ? (
          <p
            style={{
              color: darkTechTheme.colors.secondary,
              fontSize: darkTechTheme.typography.subtitle.fontSize,
              marginTop: 24,
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
