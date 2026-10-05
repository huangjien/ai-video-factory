import type { FC } from "react";
import type { BrandConfig } from "@video/vdsl";

/**
 * Branding overlay (feature 2026-10-05, marketing/branding):
 *
 * - `BrandWatermark` — the fixed brand icon at one corner of EVERY scene,
 *   for the whole duration. Rendered by Root above scene content and
 *   captions; no animation primitives so it is deterministic at any fps.
 * - `BrandIntro` — the fixed opening look: for the first
 *   `brand.intro.duration_sec` seconds the renderer adds a brand gradient
 *   band (with the channel name) plus a subtle full-screen tint, so the
 *   opening reads as one branded block while scene content stays legible.
 *
 * Pure layout helpers are exported for unit tests; the components only
 * compose them.
 */

export type BrandCorner = NonNullable<BrandConfig["corner"]>;

const MARGIN_RATIO = 0.028; // of the short edge

/** Absolute-positioning style for a watermark of `size` px at `corner`.
 * `width`/`height` scale the margin and the icon (icons authored at 1080p
 * scale proportionally on draft renders). */
export function cornerStyle(
  corner: BrandCorner,
  size: number,
  width: number,
  height: number,
): React.CSSProperties {
  const margin = Math.round(Math.min(width, height) * MARGIN_RATIO);
  const style: React.CSSProperties = {
    position: "absolute",
    width: size,
    height: size,
    pointerEvents: "none",
  };
  if (corner.startsWith("top")) style.top = margin;
  else style.bottom = margin;
  if (corner.endsWith("left")) style.left = margin;
  else style.right = margin;
  return style;
}

/** Named intro gradients — deterministic CSS, no assets needed. Each is
 * [band background, full-screen tint] so the band pops while the tint
 * only shifts the mood of the scene underneath. */
export const INTRO_GRADIENTS: Record<string, { band: string; tint: string }> = {
  aurora: {
    band: "linear-gradient(90deg, #0EA5E9 0%, #6366F1 55%, #A855F7 100%)",
    tint: "linear-gradient(135deg, rgba(14,165,233,0.16) 0%, rgba(168,85,247,0.14) 100%)",
  },
  sunset: {
    band: "linear-gradient(90deg, #F97316 0%, #EF4444 55%, #DB2777 100%)",
    tint: "linear-gradient(135deg, rgba(249,115,22,0.15) 0%, rgba(219,39,119,0.13) 100%)",
  },
  ocean: {
    band: "linear-gradient(90deg, #0369A1 0%, #0891B2 55%, #14B8A6 100%)",
    tint: "linear-gradient(135deg, rgba(3,105,161,0.16) 0%, rgba(20,184,166,0.13) 100%)",
  },
  citrus: {
    band: "linear-gradient(90deg, #FACC15 0%, #84CC16 55%, #10B981 100%)",
    tint: "linear-gradient(135deg, rgba(250,204,21,0.14) 0%, rgba(16,185,129,0.12) 100%)",
  },
};

export function introGradient(name: string): { band: string; tint: string } {
  return INTRO_GRADIENTS[name] ?? INTRO_GRADIENTS["aurora"]!;
}

/** True while the branded-opening window is active at `frame`. */
export function introWindowActive(
  frame: number,
  fps: number,
  durationSec: number,
): boolean {
  return frame / fps < durationSec;
}

export interface BrandWatermarkProps {
  brand: BrandConfig;
  width: number;
  height: number;
}

/** Corner icon shown on every scene. Renders nothing without `icon`.
 * `brand.icon` is a project-relative path OR (in rendered output) a data
 * URL inlined by the renderer's resolveImageSources — both go straight
 * into <img src>. */
export const BrandWatermark: FC<BrandWatermarkProps> = ({
  brand,
  width,
  height,
}) => {
  if (!brand.icon) return null;
  // Scale the authored-at-1080p size to the actual composition width.
  const size = Math.round((brand.size_px * width) / 1920);
  return (
    <img
      src={brand.icon}
      alt=""
      style={{
        ...cornerStyle(brand.corner, size, width, height),
        opacity: brand.opacity,
        objectFit: "contain",
        zIndex: 40,
      }}
    />
  );
};

export interface BrandIntroProps {
  brand: BrandConfig;
  /** Global frame + fps (the intro window is absolute video time). */
  frame: number;
  fps: number;
  width: number;
}

/** Branded opening chrome. Renders nothing outside the intro window. */
export const BrandIntro: FC<BrandIntroProps> = ({
  brand,
  frame,
  fps,
  width,
}) => {
  const intro = brand.intro;
  if (!intro || !introWindowActive(frame, fps, intro.duration_sec)) {
    return null;
  }
  const gradient = introGradient(intro.background);
  const bandHeight = Math.round(96 * (width / 1920));
  const fontSize = Math.round(bandHeight * 0.42);
  return (
    <>
      {/* Full-screen mood tint — low opacity keeps scene content legible. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: gradient.tint,
          pointerEvents: "none",
          zIndex: 30,
        }}
      />
      {/* Brand band across the top. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: bandHeight,
          background: gradient.band,
          display: "flex",
          alignItems: "center",
          paddingLeft: Math.round(width * 0.03),
          pointerEvents: "none",
          zIndex: 31,
        }}
      >
        {intro.show_name && brand.name ? (
          <span
            style={{
              color: "#FFFFFF",
              fontSize,
              fontWeight: 700,
              letterSpacing: Math.round(fontSize * 0.06),
              textShadow: "0 1px 4px rgba(0,0,0,0.35)",
              whiteSpace: "nowrap",
            }}
          >
            {brand.name}
          </span>
        ) : null}
      </div>
    </>
  );
};
