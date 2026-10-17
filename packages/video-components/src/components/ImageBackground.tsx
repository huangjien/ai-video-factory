import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { darkTechTheme, type Theme } from "../theme.js";
import { captionFontSize, captionTextStyle } from "../captionStyle.js";

export interface ImageBackgroundProps {
  theme?: Theme;
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
  /** Optional caption overlaid at the bottom — keeps the scene
   *  informative even when the background image is a placeholder
   *  (e.g. mock provider or failed real-provider generation).
   *  Drawn with the same type size and legibility treatment as
   *  `CaptionsOverlay` (see `captionStyle.ts`) so the two never
   *  disagree when both fire on the same scene. */
  caption?: string | undefined;
  /** Frame height, used to scale the caption. Defaults to the 1080p
   *  target; the renderer passes the real composition height. */
  height?: number | undefined;
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
  theme = darkTechTheme,
  src,
  fit = "cover",
  kenBurnsScale = 0.08,
  caption,
  height = 1080,
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
        backgroundColor: theme.colors.background,
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
      {caption !== undefined && caption.length > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 80,
            padding: "0 80px",
            textAlign: "center",
            opacity: 0.6 + 0.4 * eased,
          }}
        >
          <p
            style={{
              ...captionTextStyle(theme, captionFontSize(height)),
              fontFamily: theme.typography.title.fontFamily,
              margin: 0,
            }}
          >
            {caption}
          </p>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
