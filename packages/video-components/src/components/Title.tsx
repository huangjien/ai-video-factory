import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme } from "../theme.js";

export interface TitleProps {
  text: string;
  subtext?: string | undefined;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

export const Title: FC<TitleProps> = ({ text, subtext, frame }) => {
  const opacity = fade(frame);
  const underlineScale = fade(frame, 30);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: darkTechTheme.colors.background,
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <h1
        style={{
          color: darkTechTheme.colors.primary,
          fontFamily: darkTechTheme.typography.title.fontFamily,
          fontWeight: darkTechTheme.typography.title.fontWeight,
          fontSize: darkTechTheme.typography.title.fontSize,
          margin: 0,
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
        }}
      />
    </AbsoluteFill>
  );
};
