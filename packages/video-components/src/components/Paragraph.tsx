import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";

export interface ParagraphProps {
  theme?: Theme;
  text: string;
  /** Optional title rendered above the body in a larger, bolder
   *  weight. Useful when the paragraph is the lead paragraph of a
   *  section. */
  title?: string;
  /** Alignment of the body text. Defaults to center, which works
   *  for short explainer paragraphs; "left" suits longer body copy. */
  align?: "left" | "center" | "right";
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** Body paragraph component. The card is a soft surface that lifts
 *  the text off the page background; the type sizing is comfortable
 *  for an explainer read. */
export const Paragraph: FC<ParagraphProps> = ({
  theme = darkTechTheme,
  text,
  title,
  align = "center",
  frame,
}) => {
  const opacity = fade(frame);
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
          width: 1240,
          padding: "44px 60px",
          backgroundColor: theme.colors.surface,
          borderRadius: 16,
          border: `1px solid ${theme.colors.secondary}33`,
          boxShadow:
            "0 12px 32px rgba(15, 23, 42, 0.06), 0 2px 6px rgba(15, 23, 42, 0.04)",
        }}
      >
        {title !== undefined ? (
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: theme.colors.primary,
              fontFamily: theme.typography.subtitle.fontFamily,
              marginBottom: 20,
              textAlign: "center",
            }}
          >
            {title}
          </div>
        ) : null}
        <div
          style={{
            fontSize: 28,
            lineHeight: 1.65,
            color: theme.colors.primary,
            fontFamily: theme.typography.body.fontFamily,
            textAlign: align,
          }}
        >
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};
