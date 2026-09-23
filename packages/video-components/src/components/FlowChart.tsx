import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { draw, fade } from "../animations.js";
import { darkTechTheme } from "../theme.js";

export interface FlowChartProps {
  nodes: string[];
  edges?: [number, number][];
  direction?: "left-to-right" | "top-down";
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
  frame,
}) => {
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

  const entrance = fade(frame);
  const progress = draw(frame, 30);

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
          return (
            <g key={i} transform={`translate(${p.x},${p.y})`}>
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
