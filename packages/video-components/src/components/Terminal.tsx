import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { typewriter } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface TerminalProps {
  theme?: Theme;
  lines: string[];
  prompt?: string;
  title?: string;
  /** v0.4.1 — scene-level timeline animations. Each line `target:
   *  "line-${i}"` reveals at its own start time, replacing the global
   *  typewriter when present. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

export const Terminal: FC<TerminalProps> = ({
  theme = darkTechTheme,
  lines,
  prompt = "$",
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec =
    durationInFrames > 0
      ? frame * ((durationInFrames / 30) / durationInFrames)
      : frame / 30;

  // Per-line visibility: when animations present, reveal each line
  // according to its own `line-${i}` animation; otherwise fall back to
  // the global typewriter across all lines.
  const perLine = lines.map((line, i) => {
    if (!hasAnimations) return { line, visible: true };
    const target = `line-${i}`;
    const progress = progressFor(animations, target, sceneSec, 0.5);
    const chars = Math.max(0, Math.ceil(line.length * progress));
    return { line, visible: chars >= line.length, chars: chars };
  });

  const visibleText = hasAnimations
    ? perLine.map((p) => (p.chars ?? 0) > 0 ? p.line.slice(0, p.chars) : "").join("\n")
    : typewriter(frame, lines.join("\n"), 1.5);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.background,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: 12,
          border: `1px solid ${theme.colors.accent}`,
          padding: 24,
          width: 1600,
          fontFamily: theme.typography.code.fontFamily,
          fontSize: theme.typography.code.fontSize,
          color: theme.colors.primary,
        }}
      >
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              backgroundColor: "#FF5F57",
              display: "inline-block",
            }}
          />
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              backgroundColor: "#FEBC2E",
              display: "inline-block",
            }}
          />
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              backgroundColor: "#28C840",
              display: "inline-block",
            }}
          />
        </div>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          <span style={{ color: theme.colors.accent }}>{prompt} </span>
          {visibleText}
        </pre>
      </div>
    </AbsoluteFill>
  );
};
