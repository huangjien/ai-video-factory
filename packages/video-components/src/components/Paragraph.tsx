import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
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
  frame,
}) => (
  <AbsoluteFill
    style={{
      backgroundColor: darkTechTheme.colors.background,
      justifyContent: "center",
      alignItems: align === "left" ? "flex-start" : "center",
      padding: "10%",
      opacity: fade(frame),
    }}
  >
    <p
      style={{
        color: darkTechTheme.colors.primary,
        fontFamily: darkTechTheme.typography.body.fontFamily,
        fontSize: darkTechTheme.typography.body.fontSize,
        lineHeight: 1.6,
        maxWidth: 1600,
        textAlign: align,
        margin: 0,
      }}
    >
      {text}
    </p>
  </AbsoluteFill>
);
