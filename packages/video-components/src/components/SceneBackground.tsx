import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { darkTechTheme, type Theme } from "../theme.js";

export interface SceneBackgroundProps {
  /** Data URL — resolved by the renderer (resolveImageSources) because
   *  Remotion serves the entry over HTTP and cannot read local files. */
  src: string;
  fit?: "cover" | "contain";
  /** Fade the photo toward the THEME's surface colour so it reads as
   *  texture behind the component instead of competing with it. Lighter
   *  than ImageBackground's black band: here the component's own text is
   *  the foreground, and the default theme is light (`paper-light`), so
   *  a black veil would muddy a bright photo and break dark text.
   *  Set false for a clean full-bleed image. */
  scrim?: boolean;
  theme?: Theme;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/** Default Ken-Burns travel — a slow zoom that keeps a still photo from
 *  reading as a frozen frame. Matches ImageBackground's feel. */
const KEN_BURNS = 0.08;

/** `#RRGGBB` → `rgba(r,g,b,alpha)` so the scrim can fade the photo toward
 *  the theme surface instead of always darkening. Falls back to black
 *  when the token is not a hex string (the theme schema allows any). */
function surfaceRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(0, 0, 0, ${alpha})`;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Scrim opacity at the top / bottom of the frame. High enough that the
 *  photo reads as backdrop; low enough that it is still recognisable. */
const SCRIM_TOP = 0.55;
const SCRIM_BOTTOM = 0.75;

/**
 * The background IMAGE behind any scene component.
 *
 * Every component in the REGISTRY paints `theme.colors.background` as a
 * full-frame fill, so the renderer makes that colour transparent when a
 * background image is bound and this layer shows through. Scrim defaults
 * on; a storyboard opts out with `background: {scrim: false}`.
 */
export const SceneBackground: FC<SceneBackgroundProps> = ({
  src,
  fit = "cover",
  scrim = true,
  theme = darkTechTheme,
  durationInFrames,
  frame,
}) => {
  const t = durationInFrames > 0 ? frame / durationInFrames : 0;
  const eased = easeInOut(t);
  const scale = 1 + KEN_BURNS * eased;
  const tx = -KEN_BURNS * 60 * eased;
  const ty = -KEN_BURNS * 40 * eased;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
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
      {scrim ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(180deg, ${surfaceRgba(theme.colors.background, SCRIM_TOP)} 0%, ${surfaceRgba(theme.colors.background, SCRIM_BOTTOM)} 100%)`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
