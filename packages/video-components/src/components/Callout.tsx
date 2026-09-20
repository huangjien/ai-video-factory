import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme } from "../theme.js";

export interface CalloutProps {
  kind: "info" | "warning" | "success";
  title?: string;
  text: string;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const TINT: Record<CalloutProps["kind"], string> = {
  info: darkTechTheme.colors.accent,
  warning: darkTechTheme.colors.warning,
  success: darkTechTheme.colors.success,
};

export const Callout: FC<CalloutProps> = ({ kind, title, text, frame }) => (
  <AbsoluteFill
    style={{
      backgroundColor: darkTechTheme.colors.background,
      justifyContent: "center",
      alignItems: "center",
      opacity: fade(frame),
    }}
  >
    <div
      style={{
        width: 1500,
        border: `2px solid ${TINT[kind]}`,
        borderLeft: `12px solid ${TINT[kind]}`,
        backgroundColor: darkTechTheme.colors.surface,
        borderRadius: 12,
        padding: 32,
      }}
    >
      {title !== undefined ? (
        <h3
          style={{
            color: TINT[kind],
            fontFamily: darkTechTheme.typography.subtitle.fontFamily,
            fontSize: 36,
            margin: 0,
          }}
        >
          {title}
        </h3>
      ) : null}
      <p
        style={{
          color: darkTechTheme.colors.primary,
          fontSize: darkTechTheme.typography.body.fontSize,
          margin: 0,
          lineHeight: 1.6,
        }}
      >
        {text}
      </p>
    </div>
  </AbsoluteFill>
);
