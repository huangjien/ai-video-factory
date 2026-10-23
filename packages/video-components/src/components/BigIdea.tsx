import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface BigIdeaProps {
  theme?: Theme;
  text: string;
  /** Small label above the statement ("核心观点" / "KEY IDEA"). */
  kicker?: string;
  /** Optional small attribution below the statement (e.g. "—— Carlo"). */
  attribution?: string;
  /** v0.4.2 — `__reveal__` drives the token-by-token reveal; without it
   *  the reveal runs on a frame fallback over the first ~55% of the
   *  scene. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** CJK text has no spaces — split into characters; otherwise words. */
function tokenize(text: string): string[] {
  return /[\u4e00-\u9fa5]/.test(text)
    ? Array.from(text)
    : text.split(/\s+/).filter((t) => t.length > 0);
}

/** Full-screen typographic statement. Tokens (words, or characters for
 *  zh-CN) surface one by one under a small kicker — the "key insight"
 *  beat of an explainer. A subtle radial halo behind the text keeps
 *  the eye centered and gives the "stage" a sense of place. */
export const BigIdea: FC<BigIdeaProps> = ({
  theme = darkTechTheme,
  text,
  kicker,
  attribution,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  // Per-token reveal. With animations, each token waits for its own
  // `__reveal__` cue; without, the reveal runs as a smooth easeOut
  // over the first 55% of the scene.
  const tokens = tokenize(text);
  const reveal = hasAnimations
    ? progressFor(animations, "__reveal__", sceneSec, 0.55)
    : Math.min(1, frame / Math.max(1, durationInFrames * 0.55));
  const visibleCount = Math.max(0, Math.min(tokens.length, Math.ceil(reveal * tokens.length)));
  const visible = tokens.slice(0, visibleCount);
  // A breath on the whole statement keeps the still frame from looking
  // dead — the same 1% oscillation the Title component uses.
  const breath = 1 + Math.sin((frame / 96) * Math.PI * 2) * 0.01;
  // The kicker fades in slightly ahead of the body — sets the stage.
  const kickerOpacity = Math.max(0, Math.min(1, reveal * 1.5));
  // The whole statement finishes a touch after the last token
  // surfaces, giving the eye a beat to settle.
  const statementOpacity = Math.max(0, Math.min(1, (reveal - 0.6) / 0.4));
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "transparent",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Soft radial halo — gives the empty center of the frame a
          weight without drawing the eye away from the text. */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 1280,
          height: 720,
          borderRadius: "50%",
          background: `radial-gradient(closest-side, ${theme.colors.accent}1F, ${theme.colors.accent}00 70%)`,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 32,
          padding: "0 120px",
          maxWidth: 1500,
        }}
      >
        {/* Kicker (optional) — small uppercase label, fades in just
            before the body starts to surface. */}
        {kicker !== undefined ? (
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: theme.colors.accent,
              fontFamily: theme.typography.subtitle.fontFamily,
              opacity: kickerOpacity,
            }}
          >
            {kicker}
          </div>
        ) : null}
        {/* The main statement — center-aligned, large, with breathing. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "0 0.05em",
            fontSize: 92,
            lineHeight: 1.35,
            fontFamily: theme.typography.title.fontFamily,
            fontWeight: 700,
            color: theme.colors.primary,
            textShadow: `0 4px 24px ${theme.colors.accent}1A`,
            transform: `scale(${breath})`,
            transformOrigin: "center",
          }}
        >
          {visible.map((tok, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                // A small upward translate + fade on each token's
                // appearance gives the reveal a tactile feel.
                transform: `translateY(${(1 - 1) * 0}px)`,
              }}
            >
              {tok}
            </span>
          ))}
          {/* "..." cursor at the tail of the reveal when mid-reveal. */}
          {visibleCount < tokens.length && visibleCount > 0 ? (
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 12,
                height: 92,
                background: theme.colors.accent,
                marginLeft: 4,
                verticalAlign: "text-bottom",
                animation: "bigidea-blink 1s steps(2) infinite",
                opacity: 0.6,
              }}
            />
          ) : null}
        </div>
        {/* Attribution (optional) — small, dim, fades in last. */}
        {attribution !== undefined ? (
          <div
            style={{
              fontSize: 26,
              color: theme.colors.secondary,
              fontFamily: theme.typography.subtitle.fontFamily,
              fontStyle: "italic",
              opacity: statementOpacity,
            }}
          >
            {attribution}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
