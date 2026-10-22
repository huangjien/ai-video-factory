import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";

export interface CalloutProps {
  theme?: Theme;
  kind: "info" | "warning" | "success";
  title?: string;
  text: string;
  /** Optional CTA — shown as a small action button at the bottom. */
  cta?: string;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** Semantic palette per kind — accent + a soft tint for the card body
 *  and a contrasting ink color for the title. These don't read from the
 *  theme because the callout's job is to break the theme with a strong
 *  attention pull — like a UI callout. */
const PALETTE: Record<
  CalloutProps["kind"],
  { accent: string; tint: string; ink: string; bg: string; icon: string }
> = {
  info: {
    accent: "#2563EB",
    tint: "rgba(37, 99, 235, 0.08)",
    ink: "#1E3A8A",
    bg: "#F4F8FF",
    icon: "M12 8.5v5M12 16h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  warning: {
    accent: "#B45309",
    tint: "rgba(180, 83, 9, 0.10)",
    ink: "#7C2D12",
    bg: "#FFF8EE",
    icon: "M12 9v3.75M12 17.25h.008v.008H12v-.008zm9 5.25H3l9-15 9 15z",
  },
  success: {
    accent: "#15803D",
    tint: "rgba(21, 128, 61, 0.10)",
    ink: "#14532D",
    bg: "#F0FDF4",
    icon: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
};

export const Callout: FC<CalloutProps> = ({
  kind,
  title,
  text,
  cta,
  frame,
  theme = darkTechTheme,
}) => {
  const P = PALETTE[kind];
  // Card geometry — narrower than the old 1500-px body so there's room
  // for the icon and CTA, and the content reads as a focused unit.
  const W = 1200;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "transparent",
        justifyContent: "center",
        alignItems: "center",
        opacity: fade(frame),
      }}
    >
      <div
        style={{
          width: W,
          backgroundColor: P.bg,
          border: `1.5px solid ${P.accent}`,
          borderLeft: `8px solid ${P.accent}`,
          borderRadius: 16,
          padding: "32px 40px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          // Two-stop drop shadow: a soft ambient + a tighter edge to
          // lift the card off the background without looking like a
          // generic Material box.
          boxShadow:
            "0 18px 40px rgba(15, 23, 42, 0.10), 0 2px 6px rgba(15, 23, 42, 0.06)",
        }}
      >
        {/* Title row: kind icon + label + optional badge. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            pointerEvents: "none",
          }}
        >
          <svg
            width={36}
            height={36}
            viewBox="0 0 24 24"
            fill="none"
            stroke={P.accent}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d={P.icon} />
          </svg>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              color: P.ink,
              fontFamily: theme.typography.subtitle.fontFamily,
            }}
          >
            {kind}
          </div>
          {/* Optional badge — surfaced by passing `cta`. Visually subtle
              so the body text stays the main content. */}
          {cta !== undefined ? (
            <div
              style={{
                marginLeft: "auto",
                padding: "6px 14px",
                borderRadius: 999,
                backgroundColor: P.tint,
                color: P.ink,
                fontSize: 16,
                fontWeight: 600,
                fontFamily: theme.typography.body.fontFamily,
              }}
            >
              {cta}
            </div>
          ) : null}
        </div>

        {/* Optional title — bigger, more prominent than the body. */}
        {title !== undefined ? (
          <h3
            style={{
              color: P.ink,
              fontFamily: theme.typography.subtitle.fontFamily,
              fontSize: 38,
              fontWeight: 700,
              margin: 0,
              lineHeight: 1.25,
            }}
          >
            {title}
          </h3>
        ) : null}

        {/* Body text. The user-supplied string is rendered verbatim
            (no remotion `text-wrap`); if it's long, keep lines short
            upstream. */}
        <p
          style={{
            color: theme.colors.primary,
            fontSize: 28,
            lineHeight: 1.55,
            margin: 0,
            fontFamily: theme.typography.body.fontFamily,
          }}
        >
          {text}
        </p>
      </div>
    </AbsoluteFill>
  );
};
