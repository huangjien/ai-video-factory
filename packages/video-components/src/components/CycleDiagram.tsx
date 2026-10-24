import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface CycleStage {
  /** Stage label — first stage at 12 o'clock by default. */
  label: string;
  /** Optional short detail shown under the stage node. */
  detail?: string;
  /** Single-letter monogram shown inside the stage circle. Falls
   *  back to the first character of `label` if omitted. */
  icon?: string;
}

export interface CycleDiagramProps {
  theme?: Theme;
  /** 1–8 stages in rotation order. Strings are treated as `{label}`
   *  for back-compat. */
  stages: (string | CycleStage)[];
  /** Text shown in the ring's center. */
  title?: string;
  /** Optional caption shown under the diagram. */
  caption?: string;
  /** v0.4.2 — `__ring__` draws the dashed orbit, `stage-${i}` lights each
   *  node in sequence. The ring's slow rotation is frame-driven and
   *  needs no animation entry. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const CX = 960;
const CY = 560;
const R = 310;
const NODE_R = 48;

/** Slow continuous rotation of the entire diagram. Drives the
 *  "process never stops" feel without depending on a separate animation
 *  cue — frame math only. */
function rotation(frame: number, duration: number): number {
  if (duration <= 0) return 0;
  // Half a turn over the full scene.
  return (frame / duration) * Math.PI;
}

export const CycleDiagram: FC<CycleDiagramProps> = ({
  theme = darkTechTheme,
  stages = [],
  title,
  caption,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  const typed: CycleStage[] = stages.map((s) =>
    typeof s === "string" ? { label: s } : s,
  );
  // Cap to 8 nodes so the geometry stays legible.
  const shown = typed.slice(0, 8);
  const n = shown.length;
  const rot = rotation(frame, durationInFrames);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "transparent",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 1920 1080">
        <defs>
          {/* Arrowhead marker — the dashed orbit ends in an arrow
              so the cycle reads as a direction, not just a ring. */}
          <marker
            id="cycle-arrow"
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={9}
            markerHeight={9}
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.colors.accent} />
          </marker>
          <filter
            id="cycle-shadow"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feGaussianBlur in="SourceAlpha" stdDeviation="4" />
            <feOffset dx="0" dy="3" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.15" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Center disc — slightly tinted surface holding the title. The
            rotation of the rest of the diagram is anchored here so
            the title stays readable while the ring spins around it. */}
        <g transform={`translate(${CX}, ${CY})`}>
          <circle r={120} fill={theme.colors.surface} opacity={0.92} />
          <circle
            r={120}
            fill="none"
            stroke={theme.colors.accent}
            strokeWidth={2}
            opacity={0.4}
          />
          {title !== undefined ? (
            <text
              y={-4}
              fill={theme.colors.primary}
              fontSize={26}
              fontWeight={600}
              textAnchor="middle"
              fontFamily={theme.typography.subtitle.fontFamily}
            >
              {title}
            </text>
          ) : null}
          {caption !== undefined ? (
            <text
              y={28}
              fill={theme.colors.secondary}
              fontSize={16}
              textAnchor="middle"
              fontFamily={theme.typography.body.fontFamily}
            >
              {caption}
            </text>
          ) : null}
        </g>

        {/* Rotating assembly — the orbit + nodes spin together. */}
        <g
          transform={`translate(${CX}, ${CY}) rotate(${rot * (180 / Math.PI)})`}
        >
          {/* Dashed orbit — drawn on entry via the standard `__ring__`
              animation when present, or as a static ring on frame 0. */}
          <circle
            r={R}
            fill="none"
            stroke={theme.colors.accent}
            strokeWidth={3}
            strokeDasharray="8 8"
            opacity={
              hasAnimations
                ? progressFor(animations, "__ring__", sceneSec, 0.6)
                : fade(frame, 24)
            }
          />
          {/* Inner guide ring — a faint full circle that anchors the
              orbit's shape even when the dashes are still animating on. */}
          <circle
            r={R}
            fill="none"
            stroke={theme.colors.secondary}
            strokeWidth={1}
            opacity={0.18}
          />
          {shown.map((stage, i) => {
            const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(angle) * R;
            const y = Math.sin(angle) * R;
            const stageProgress = hasAnimations
              ? progressFor(animations, `stage-${i}`, sceneSec, 0.5)
              : fade(frame - i * 6, 18);
            // Current stage — the one that just lit up — is highlighted
            // with a stronger ring + filled background. Other stages get
            // a softer outline.
            const isCurrent = hasAnimations
              ? stageProgress > 0.6 && stageProgress < 0.99
              : false;
            return (
              <g
                key={`stage-${i}`}
                transform={`translate(${x}, ${y})`}
                opacity={stageProgress}
                filter="url(#cycle-shadow)"
              >
                {/* Outer guide ring (a thin track the node sits on). */}
                <circle
                  r={NODE_R + 6}
                  fill="none"
                  stroke={theme.colors.accent}
                  strokeWidth={1.5}
                  opacity={0.4}
                />
                {/* Node body — filled when current, outlined when past. */}
                <circle
                  r={NODE_R}
                  fill={isCurrent ? theme.colors.accent : theme.colors.surface}
                  stroke={theme.colors.accent}
                  strokeWidth={isCurrent ? 4 : 2.5}
                />
                {/* Stage number (1-based) above the node. */}
                <text
                  x={0}
                  y={-NODE_R - 10}
                  fill={theme.colors.secondary}
                  fontSize={18}
                  fontWeight={600}
                  textAnchor="middle"
                  fontFamily={theme.typography.code.fontFamily}
                >
                  {String(i + 1).padStart(2, "0")}
                </text>
                {/* Icon monogram (single character from `icon` or first of label) */}
                <text
                  x={0}
                  y={6}
                  fill={isCurrent ? "#FFFFFF" : theme.colors.accent}
                  fontSize={28}
                  fontWeight={700}
                  textAnchor="middle"
                  fontFamily={theme.typography.subtitle.fontFamily}
                >
                  {(stage.icon ?? stage.label).charAt(0).toUpperCase()}
                </text>
                {/* Stage label — placed outside the ring (radially out
                    from center) so the labels don't crash into each
                    other. Alternates above / below the center. */}
                <text
                  x={x > 0 ? NODE_R + 14 : -(NODE_R + 14)}
                  y={x > 0 ? 6 : 6}
                  textAnchor={x > 0 ? "start" : "end"}
                  fill={theme.colors.primary}
                  fontSize={20}
                  fontWeight={600}
                  fontFamily={theme.typography.subtitle.fontFamily}
                >
                  {stage.label}
                </text>
                {/* Detail (smaller, muted) under the label. */}
                {stage.detail !== undefined ? (
                  <text
                    x={x > 0 ? NODE_R + 14 : -(NODE_R + 14)}
                    y={28}
                    textAnchor={x > 0 ? "start" : "end"}
                    fill={theme.colors.secondary}
                    fontSize={15}
                    fontFamily={theme.typography.body.fontFamily}
                  >
                    {stage.detail}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
    </AbsoluteFill>
  );
};
