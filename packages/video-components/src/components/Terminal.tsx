import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { typewriter } from "../animations.js";
import { darkTechTheme } from "../theme.js";

export interface TerminalProps {
  lines: string[];
  prompt?: string;
  title?: string;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

export const Terminal: FC<TerminalProps> = ({
  lines,
  prompt = "$",
  frame,
}) => {
  const charsPerFrame = 1.5;
  const text = lines.join("\n");
  const visible = typewriter(frame, text, charsPerFrame);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: darkTechTheme.colors.background,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          backgroundColor: darkTechTheme.colors.surface,
          borderRadius: 12,
          border: `1px solid ${darkTechTheme.colors.accent}`,
          padding: 24,
          width: 1600,
          fontFamily: darkTechTheme.typography.code.fontFamily,
          fontSize: darkTechTheme.typography.code.fontSize,
          color: darkTechTheme.colors.primary,
        }}
      >
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              backgroundColor: "#FF5F57",
              display: "inline-block",
            }}
          />
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              backgroundColor: "#FEBC2E",
              display: "inline-block",
            }}
          />
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              backgroundColor: "#28C840",
              display: "inline-block",
            }}
          />
        </div>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          <span style={{ color: darkTechTheme.colors.accent }}>{prompt} </span>
          {visible}
        </pre>
      </div>
    </AbsoluteFill>
  );
};
