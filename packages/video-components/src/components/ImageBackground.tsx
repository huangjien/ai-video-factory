import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { darkTechTheme, type Theme } from "../theme.js";
import {
  captionContainerStyle,
  captionFontSize,
  captionLineStyle,
  captionTextStyle,
} from "../captionStyle.js";

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
  /** Frame width, used to scale the caption's max-width. The renderer
   *  passes the real composition width. */
  width?: number | undefined;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/** Percentage of frame height left untouched by the caption veil. */
const SCRIM_CLEAN_UNTIL = 55;
/** Peak veil alpha, reached only at the bottom edge. */
const SCRIM_BOTTOM = 0.5;

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
  width = 1920,
  height = 1080,
  startFrame,
  durationInFrames,
  frame,
}) => {
  const t = durationInFrames > 0 ? frame / durationInFrames : 0;
  const eased = easeInOut(t);
  // `eased` is a function of `frame`, so motion must be gated on `still`
  // too — otherwise a `kenBurnsScale: 0` frame keeps fading in.
  const still = kenBurnsScale === 0;
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
        }}
      />
      {/* Bottom-weighted, not a full-frame wash: captionStyle.ts already gives
          every glyph a 0.92-alpha outline, so only the caption band needs
          contrast. A full wash cost a paper-white ground half its luma. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) ${SCRIM_CLEAN_UNTIL}%, rgba(0,0,0,${SCRIM_BOTTOM}) 100%)`,
        }}
      />
      {caption !== undefined && caption.length > 0 ? (
        <div
          style={{
            ...captionContainerStyle(height),
            // Fade-in only — geometry and type come from the shared
            // captionStyle.ts so this band can never drift from the
            // CaptionsOverlay track.
            opacity: still ? 1 : 0.6 + 0.4 * eased,
          }}
        >
          <p
            style={{
              ...captionLineStyle(width, height),
              ...captionTextStyle(theme, captionFontSize(height)),
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
