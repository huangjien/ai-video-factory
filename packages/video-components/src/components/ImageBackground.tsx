import type { FC } from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { darkTechTheme } from "../theme.js";

export interface ImageBackgroundProps {
  /** Path to a project image (relative to the project root or
   * absolute). Read from `assets/images/` by convention; can also be
   * `staticFile("...")`-wrapped if you want to use Remotion's
   * asset-pipeline bundling. */
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
 * Static project image rendered as the scene background with subtle
 * Ken-Burns motion (slow zoom + pan). When no image is provided the
 * scene falls back to the shared animated `Background` component in
 * the parent (`Root.tsx`) — so this is opt-in for users that want a
 * specific image per scene.
 *
 * Reads from the project's `assets/images/` directory by convention
 * (the same path the v0.2 image asset pipeline writes to).
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
        src={staticFile(src)}
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
