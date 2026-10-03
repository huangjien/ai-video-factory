import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";

export interface CodeBlockProps {
  theme?: Theme;
  code: string;
  language?: string;
  highlightLines?: number[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

export const CodeBlock: FC<CodeBlockProps> = ({
  theme = darkTechTheme,
  code,
  highlightLines = [],
  frame,
}) => {
  const lines = code.split("\n");
  const opacity = fade(frame);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.background,
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <pre
        style={{
          backgroundColor: theme.colors.surface,
          color: theme.colors.primary,
          fontFamily: theme.typography.code.fontFamily,
          fontSize: theme.typography.code.fontSize,
          lineHeight: 1.5,
          padding: 32,
          borderRadius: 12,
          border: `1px solid ${theme.colors.accent}`,
          maxWidth: 1600,
          margin: 0,
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              backgroundColor: highlightLines.includes(i + 1)
                ? `${theme.colors.accent}33`
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
