import type { FC } from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme } from "../theme.js";

export interface ImageProps {
  src: string;
  fit?: "contain" | "cover";
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** Plain <img> for v0.1 (Remotion's <Img> uses hooks that require a
 * Composition context — unsuitable for SSR / static rendering tests).
 * Replace with <Img> + delayRender once we have network images in v0.2. */
export const Image: FC<ImageProps> = ({ src, fit = "contain", frame }) => (
  <AbsoluteFill
    style={{
      backgroundColor: darkTechTheme.colors.background,
      justifyContent: "center",
      alignItems: "center",
      opacity: fade(frame),
    }}
  >
    <img
      src={staticFile(src)}
      alt=""
      style={{
        objectFit: fit,
        width: "80%",
        height: "80%",
      }}
    />
  </AbsoluteFill>
);
