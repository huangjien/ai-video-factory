import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { entrance, fadeOut, typewriter } from "../animations.js";
import { darkTechTheme } from "../theme.js";

export interface ParagraphProps {
  text: string;
  align?: "left" | "center";
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

export const Paragraph: FC<ParagraphProps> = ({
  text,
  align = "center",
  startFrame,
  durationInFrames,
  frame,
}) => {
  const enter = entrance(frame, 20, "left");
  const exit = fadeOut(frame, durationInFrames, 18);
  const opacity = enter.opacity * exit;
  const translateX = enter.translate;
  const visibleText = typewriter(frame, text, 1.2);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: darkTechTheme.colors.background,
        justifyContent: "center",
        alignItems: align === "left" ? "flex-start" : "center",
        padding: "10%",
        opacity,
      }}
    >
      <div
        style={{
          transform: `translateX(${translateX}px)`,
          maxWidth: 1600,
        }}
      >
        <p
          style={{
            color: darkTechTheme.colors.primary,
            fontFamily: darkTechTheme.typography.body.fontFamily,
            fontSize: darkTechTheme.typography.body.fontSize,
            lineHeight: 1.6,
            textAlign: align,
            margin: 0,
          }}
        >
          {visibleText}
          {visibleText.length < text.length ? (
            <span
              style={{
                opacity: 0.6 + 0.4 * Math.sin(frame * 0.3),
                color: darkTechTheme.colors.accent,
              }}
            >
              ▍
            </span>
          ) : null}
        </p>
      </div>
    </AbsoluteFill>
  );
};
