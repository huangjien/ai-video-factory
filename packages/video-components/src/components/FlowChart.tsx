import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { draw, fade } from "../animations.js";
import { darkTechTheme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface FlowChartProps {
  nodes: string[];
  edges?: [number, number][];
  direction?: "left-to-right" | "top-down";
  /** v0.4.1 — scene-level timeline animations. When present, each
   *  node `target: "node-${i}"` fades+scales in at its own start time
   *  instead of using a single global entrance. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const NODE_W = 240;
const NODE_H = 80;
const GAP_X = 80;
const GAP_Y = 120;

export const FlowChart: FC<FlowChartProps> = ({
  nodes,
  edges = [],
  direction = "left-to-right",
  animations,
  frame,
  durationInFrames,
}) => {
  // Use the frame-count / scene-duration ratio to derive the local fps,
  // so animations stay in sync with the composition (draft = 15fps,
  // final = 30fps). When durationInFrames is 0 (shouldn't happen), fall
  // back to 30fps so sceneSec is well-defined.
  const sceneSec =
    durationInFrames > 0 ? frame * ((durationInFrames / 30) / durationInFrames) : frame / 30;
  const cols =
    direction === "left-to-right" ? Math.ceil(Math.sqrt(nodes.length)) : 1;
  const positions = nodes.map((_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x: direction === "left-to-right" ? 200 + col * (NODE_W + GAP_X) : 800,
      y: direction === "left-to-right" ? 400 : 120 + row * (NODE_H + GAP_Y),
    };
  });

  // Back-compat: no animations → single global entrance + uniform edges.
  // Animations present → per-node fade+scale at its own start.
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const entrance = hasAnimations ? 1 : fade(frame);
  const progress = hasAnimations ? 1 : draw(frame, 30);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: darkTechTheme.colors.background,
        opacity: entrance,
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 1920 1080">
        {edges.map(([from, to], i) => {
          const a = positions[from];
          const b = positions[to];
          if (!a || !b) return null;
          const dx = b.x - a.x;
          const length = Math.sqrt(dx * dx + (b.y - a.y) ** 2);
          const perEdge = length * progress;
          return (
            <line
              key={i}
              x1={a.x + NODE_W / 2}
              y1={a.y + NODE_H / 2}
              x2={b.x + NODE_W / 2}
              y2={b.y + NODE_H / 2}
              stroke={darkTechTheme.colors.accent}
              strokeWidth={4}
              strokeDasharray={length}
              strokeDashoffset={length - perEdge}
            />
          );
        })}
        {nodes.map((label, i) => {
          const p = positions[i];
          if (!p) return null;
          // Per-node animation when present; otherwise render at full
          // opacity so the global entrance handles the fade.
          const nodeProgress = hasAnimations
            ? progressFor(animations, `node-${i}`, sceneSec, 0.5)
            : 1;
          const nodeScale = 0.92 + 0.08 * nodeProgress;
          return (
            <g
              key={i}
              transform={`translate(${p.x},${p.y}) scale(${nodeScale})`}
              opacity={hasAnimations ? nodeProgress : 1}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={12}
                fill={darkTechTheme.colors.surface}
                stroke={darkTechTheme.colors.accent}
                strokeWidth={2}
              />
              <text
                x={NODE_W / 2}
                y={NODE_H / 2}
                fill={darkTechTheme.colors.primary}
                fontSize={24}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily={darkTechTheme.typography.body.fontFamily}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
