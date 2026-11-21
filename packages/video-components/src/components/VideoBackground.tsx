import type { FC } from "react";
import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import { darkTechTheme, type Theme } from "../theme.js";
import {
  captionContainerStyle,
  captionFontSize,
  captionLineStyle,
  captionTextStyle,
} from "../captionStyle.js";

export interface VideoBackgroundProps {
  theme?: Theme;
  /** Video source — a Remotion `staticFile()` path (the render step
   *  copies `assets/video/scene_N.mp4` into the bundler's public dir).
   *  Unlike `ImageBackground` (data URLs painted by the headless
   *  browser), video must be served by the bundler, so this is a
   *  public-dir-relative path, never a data URL. */
  videoSrc: string;
  /** Fit mode — cover fills the frame (may crop); contain fits
   *  without cropping. Defaults to cover. */
  fit?: "cover" | "contain";
  /** Optional caption overlaid at the bottom — same type size and
   *  legibility treatment as `CaptionsOverlay` /
   *  `ImageBackground` so all three surfaces never disagree when
   *  they fire on the same scene. */
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

/** Percentage of frame height left untouched by the caption veil.
 *  Kept in sync with ImageBackground — the two backgrounds must
 *  scrim identically so a scene switching between them mid-film
 *  does not visibly change its caption-band treatment. */
const SCRIM_CLEAN_UNTIL = 55;
/** Peak veil alpha, reached only at the bottom edge. */
const SCRIM_BOTTOM = 0.5;

/**
 * Scene background from a public-domain archival clip. The clip is
 * preprocessed upstream (see @video/video-sources preprocess: cover-crop
 * to 1080×1920, audio stripped, trimmed to scene duration) so this
 * component stays dumb: loop, mute, scrim, caption.
 *
 * No Ken-Burns — the footage already moves, and transforming it would
 * fight the historical framing. `<OffthreadVideo>` extracts frames
 * deterministically at render time.
 */
export const VideoBackground: FC<VideoBackgroundProps> = ({
  theme = darkTechTheme,
  videoSrc,
  fit = "cover",
  caption,
  width = 1920,
  height = 1080,
  startFrame,
  durationInFrames,
}) => {
  void startFrame;
  void durationInFrames;
  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        backgroundColor: theme.colors.background,
      }}
    >
      <OffthreadVideo
        src={staticFile(videoSrc)}
        muted
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: fit,
        }}
      />
      {/* Same bottom-weighted scrim as ImageBackground — see the note
          on SCRIM_CLEAN_UNTIL above. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) ${SCRIM_CLEAN_UNTIL}%, rgba(0,0,0,${SCRIM_BOTTOM}) 100%)`,
        }}
      />
      {caption !== undefined && caption.length > 0 ? (
        <div style={{ ...captionContainerStyle(height), opacity: 1 }}>
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
