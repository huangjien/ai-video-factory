import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { darkTechTheme } from "../theme.js";

export interface ImageBackgroundProps {
  /** Image source — data URL (`data:image/jpeg;base64,...`) or any
   * URL the headless browser can resolve. File paths must be converted
   * to data URLs upstream (see renderPlanToVideo). */
  src: string;
  /** Fit mode — cover fills the frame (may crop); contain fits
   * without cropping. Defaults to cover for background use. */
  fit?: "cover" | "contain";
  /** Ken-Burns motion: slow zoom + pan throughout the scene so the
   * background reads as alive rather than static. Set to 0 to disable. */
  kenBurnsScale?: number;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/**
 * Scene background from an AI-generated image with subtle Ken-Burns
 * motion (slow zoom + pan). Accepts data URLs — file paths must be
 * resolved to data URLs by the caller because Remotion's bundler
 * serves the entry over HTTP, blocking file:// access.
 */
export const ImageBackground: FC<ImageBackgroundProps> = ({
  src,
  fit = "cover",
  kenBurnsScale = 0.08,
  frame,
  durationInFrames,
}) => {
  const t = durationInFrames > 0 ? frame / durationInFrames : 0;
  const eased = easeInOut(t);
  const scale = 1 + kenBurnsScale * eased;
  const tx = -kenBurnsScale * 60 * eased;
  const ty = -kenBurnsScale * 40 * eased;
  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        backgroundColor: darkTechTheme.colors.background,
      }}
    >
      <img
        src={src}
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: fit,
          transform: `scale(${scale}) translate(${tx}px, ${ty}px)`,
          opacity: 0.85 + 0.15 * eased,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.65) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
