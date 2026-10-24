import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";

export interface ImageProps {
  theme?: Theme;
  src: string;
  /** Alt text. Not rendered (the component is a full-frame image with
   *  no caption), but the prop is kept so callers don't lose semantics
   *  on export. */
  alt?: string;
  /** Object-fit behavior — "cover" fills the frame, "contain" letter-
   *  boxes. Defaults to "cover". */
  fit?: "cover" | "contain";
  /** Optional caption shown under the image. */
  caption?: string;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** Raw <img> element sized to the frame. The optional caption sits
 *  below the image inside the same rounded card so the image+text
 *  reads as a single unit. */
export const Image: FC<ImageProps> = ({
  theme = darkTechTheme,
  src,
  alt,
  fit = "cover",
  caption,
  frame,
}) => {
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          maxWidth: 1480,
        }}
      >
        <img
          src={src}
          alt={alt ?? ""}
          style={{
            width: "100%",
            maxHeight: caption !== undefined ? 840 : 980,
            objectFit: fit,
            borderRadius: 12,
            boxShadow:
              "0 18px 40px rgba(0,0,0,0.20), 0 4px 12px rgba(0,0,0,0.10)",
          }}
        />
        {caption !== undefined ? (
          <div
            style={{
              fontSize: 26,
              color: theme.colors.secondary,
              fontFamily: theme.typography.body.fontFamily,
              textAlign: "center",
              maxWidth: 1200,
            }}
          >
            {caption}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
