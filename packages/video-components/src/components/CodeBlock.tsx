import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme } from "../theme.js";

export interface CodeBlockProps {
  code: string;
  language?: string;
  highlightLines?: number[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

export const CodeBlock: FC<CodeBlockProps> = ({
  code,
  highlightLines = [],
  frame,
}) => {
  const lines = code.split("\n");
  const opacity = fade(frame);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: darkTechTheme.colors.background,
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <pre
        style={{
          backgroundColor: darkTechTheme.colors.surface,
          color: darkTechTheme.colors.primary,
          fontFamily: darkTechTheme.typography.code.fontFamily,
          fontSize: darkTechTheme.typography.code.fontSize,
          lineHeight: 1.5,
          padding: 32,
          borderRadius: 12,
          border: `1px solid ${darkTechTheme.colors.accent}`,
          maxWidth: 1600,
          margin: 0,
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              backgroundColor: highlightLines.includes(i + 1)
                ? `${darkTechTheme.colors.accent}33`
                : "transparent",
              padding: "2px 8px",
              margin: "0 -8px",
            }}
          >
            {line || "\u00A0"}
          </div>
        ))}
      </pre>
    </AbsoluteFill>
  );
};
