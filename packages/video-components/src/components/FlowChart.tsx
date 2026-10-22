import type { FC, ReactElement } from "react";
import { AbsoluteFill } from "remotion";
import { draw, fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

/**
 * Semantic kinds the renderer can draw distinctly. Decision nodes are
 * diamond-shaped; start/end are filled pills; process is a rounded
 * rectangle. When a node omits `kind` it defaults to "process" — so
 * existing call sites that pass plain strings keep working unchanged.
 */
export type FlowNodeKind = "start" | "process" | "decision" | "end";

export interface FlowNode {
  label: string;
  kind?: FlowNodeKind;
}

export interface FlowEdge {
  from: number;
  to: number;
  /** Optional label at the edge midpoint — typically "yes" / "no" on
   *  decision branches. Renders as a small chip sitting on the arrow. */
  label?: string;
}

export interface FlowChartProps {
  theme?: Theme;
  /** Either plain strings (all treated as "process") or FlowNode objects
   *  with explicit kinds. The mixed-form is the most common — only
   *  decision / start / end nodes need the object form. */
  nodes: (string | FlowNode)[];
  /** Edges as `[from, to]` tuples (back-compat) or FlowEdge objects when
   *  labels are needed. */
  edges?: ([number, number] | FlowEdge)[];
  direction?: "left-to-right" | "top-down";
  /** v0.4.1 — scene-level timeline animations. When present, each
   *  node `target: "node-${i}"` fades+scales in at its own start time
   *  instead of using a single global entrance. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

// Geometry constants. Sized for the 1920×1080 frame — node width 280
// gives ~16-char labels at 28 px before wrap. Tall enough to fit two
// lines of text.
const NODE_W = 280;
const NODE_H = 96;
const GAP_X = 100;
const GAP_Y = 140;
const FONT_PX = 28;
const FONT_WEIGHT_NODE = 600;
const FONT_WEIGHT_LABEL = 500;
const FONT_PX_LABEL = 22;
const ARROW_HEAD_LEN = 14;
const ARROW_HEAD_WID = 12;
const NODE_RX = 14;

// Pill dims for start/end (rounded fully)
const PILL_H = 64;

function isFlowEdgeObject(
  e: [number, number] | FlowEdge,
): e is FlowEdge {
  return typeof e === "object" && !Array.isArray(e);
}

function nodeLabel(n: string | FlowNode): string {
  return typeof n === "string" ? n : n.label;
}
function nodeKind(n: string | FlowNode): FlowNodeKind {
  if (typeof n === "string") return "process";
  return n.kind ?? "process";
}

export const FlowChart: FC<FlowChartProps> = ({
  theme = darkTechTheme,
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
    durationInFrames > 0
      ? frame * (durationInFrames / 30 / durationInFrames)
      : frame / 30;

  // Layout. For a real flowchart, columns alternate by kind direction
  // — but in this codebase every scene uses 2-3 nodes with
  // direction=left-to-right, so the math below is the simple "place each
  // node on a grid" path. Override the X for "top-down" so the line
  // connecting two nodes is vertical.
  const cols =
    direction === "left-to-right" ? Math.max(1, nodes.length) : 1;
  const positions = nodes.map((_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x:
        direction === "left-to-right"
          ? Math.round(1920 / 2) +
            (col - (cols - 1) / 2) * (NODE_W + GAP_X) -
            NODE_W / 2
          : 1920 / 2 - NODE_W / 2,
      y:
        direction === "left-to-right"
          ? 1080 / 2 - NODE_H / 2
          : 200 + row * (NODE_H + GAP_Y),
    };
  });

  // Back-compat: no animations → single global entrance + uniform edges.
  // Animations present → per-node fade+scale at its own start.
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const entrance = hasAnimations ? 1 : fade(frame);
  const progress = hasAnimations ? 1 : draw(frame, 30);

  // Palette derived from the active theme. Keep a few derived colors so
  // the chart doesn't read as monochrome:
  //   accent   — for the primary "process" box and the arrow line
  //   accentAlt — for decision nodes (decision reads as "branching")
  //   success  — for start/end pills
  //   surface  — for the box fill (off-white from theme)
  //   onSurface — text on the box
  //   onAccent  — text inside the pill (sits on the accent fill)
  const surface = theme.colors.surface;
  const onSurface = theme.colors.primary;
  const accent = theme.colors.accent;
  const accentAlt = "#E8A33D"; // amber, readable on both light and dark
  const success = "#3FAA6B";   // green for start/end
  const onAccent = "#FFFFFF";
  const edge = theme.colors.primary;
  const labelBg = theme.colors.surface;
  const labelText = theme.colors.primary;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "transparent",
        opacity: entrance,
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 1920 1080"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Soft drop shadow on the node group — modern chart aesthetic.
            Cheap filter; the SVG renderer is happy with feGaussianBlur. */}
        <defs>
          <filter
            id="flow-shadow"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feGaussianBlur in="SourceAlpha" stdDeviation="6" />
            <feOffset dx="0" dy="4" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.18" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Arrowheads. One marker per palette so we can recolor
              edges per kind (decision branch in amber, normal in accent). */}
          <marker
            id="arrow"
            viewBox="0 0 ARROW_HEAD_LEN ARROW_HEAD_WID"
            refX={ARROW_HEAD_LEN}
            refY={ARROW_HEAD_WID / 2}
            markerWidth={ARROW_HEAD_LEN}
            markerHeight={ARROW_HEAD_WID}
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path
              d={`M 0 0 L ${ARROW_HEAD_LEN} ${ARROW_HEAD_WID / 2} L 0 ${ARROW_HEAD_WID} z`}
              fill={edge}
            />
          </marker>
          <marker
            id="arrow-amber"
            viewBox="0 0 ARROW_HEAD_LEN ARROW_HEAD_WID"
            refX={ARROW_HEAD_LEN}
            refY={ARROW_HEAD_WID / 2}
            markerWidth={ARROW_HEAD_LEN}
            markerHeight={ARROW_HEAD_WID}
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path
              d={`M 0 0 L ${ARROW_HEAD_LEN} ${ARROW_HEAD_WID / 2} L 0 ${ARROW_HEAD_WID} z`}
              fill={accentAlt}
            />
          </marker>
        </defs>

        {/* Edges first so they sit under the nodes. Bezier control
            points push the midpoint up/down a touch for a friendlier
            curve than a hard line. The line is drawn-on via
            stroke-dasharray, with the arrowhead's "auto-start-reverse"
            orient keeping it pointing in the direction of travel. */}
        {edges.map((rawEdge, i) => {
          const e = isFlowEdgeObject(rawEdge)
            ? rawEdge
            : { from: rawEdge[0], to: rawEdge[1] };
          const a = positions[e.from];
          const b = positions[e.to];
          if (!a || !b) return null;
          // Anchor: edge of source box → edge of destination box, so
          // the line doesn't visually start "inside" the box.
          const fromIsLeft = b.x >= a.x;
          const aX = fromIsLeft ? a.x + NODE_W : a.x;
          const bX = fromIsLeft ? b.x : b.x + NODE_W;
          const aY = a.y + NODE_H / 2;
          const bY = b.y + NODE_H / 2;
          // Cubic bezier control points — gentle S-curve
          const dx = Math.abs(bX - aX) * 0.45;
          const c1X = aX + (fromIsLeft ? dx : -dx);
          const c2X = bX + (fromIsLeft ? -dx : dx);
          const d = `M ${aX} ${aY} C ${c1X} ${aY} ${c2X} ${bY} ${bX} ${bY}`;
          // Path length for the stroke-dasharray draw-on trick. The
          // browser computes it lazily; an explicit length isn't needed
          // in modern browsers.
          // Decide color: amber if the source is a decision and the
          // edge has a label (typical "yes" / "no" branch). Otherwise
          // the theme's primary.
          const isDecisionBranch =
            nodeKind(nodes[e.from] ?? "") === "decision" && e.label !== undefined;
          const stroke = isDecisionBranch ? accentAlt : edge;
          // Stagger edge draw: each edge completes in turn.
          const totalEdges = Math.max(1, edges.length);
          const segPer = 1 / totalEdges;
          const segStart = i * segPer;
          const localProgress = Math.max(
            0,
            Math.min(1, (progress - segStart) / segPer),
          );
          return (
            <g key={`edge-${i}`}>
              <path
                d={d}
                stroke={stroke}
                strokeWidth={3.5}
                fill="none"
                strokeLinecap="round"
                strokeDasharray="1 0"
                pathLength={1}
                strokeDashoffset={1 - localProgress}
                markerEnd={`url(#${isDecisionBranch ? "arrow-amber" : "arrow"})`}
                opacity={hasAnimations ? 1 : Math.max(0.25, localProgress)}
              />
              {/* Edge label chip — sits at the midpoint, slight backdrop so
                  it reads against the curve and any background. */}
              {e.label !== undefined ? (() => {
                const mx = (aX + bX) / 2;
                const my = (aY + bY) / 2;
                const labelW = Math.max(
                  e.label.length * (FONT_PX_LABEL * 0.55) + 28,
                  64,
                );
                const labelH = FONT_PX_LABEL + 14;
                return (
                  <g
                    transform={`translate(${mx - labelW / 2}, ${my - labelH / 2})`}
                    opacity={Math.max(0, localProgress - 0.1) / 0.9}
                  >
                    <rect
                      width={labelW}
                      height={labelH}
                      rx={labelH / 2}
                      fill={labelBg}
                      stroke={stroke}
                      strokeWidth={1.5}
                    />
                    <text
                      x={labelW / 2}
                      y={labelH / 2}
                      fill={labelText}
                      fontSize={FONT_PX_LABEL}
                      fontWeight={FONT_WEIGHT_LABEL}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontFamily={theme.typography.body.fontFamily}
                    >
                      {e.label}
                    </text>
                  </g>
                );
              })() : null}
            </g>
          );
        })}

        {/* Nodes — drawn over the edges. Each gets its own kind-shaped
            geometry and color treatment. */}
        {nodes.map((rawNode, i) => {
          const label = nodeLabel(rawNode);
          const kind = nodeKind(rawNode);
          const p = positions[i];
          if (!p) return null;
          const nodeProgress = hasAnimations
            ? progressFor(animations, `node-${i}`, sceneSec, 0.5)
            : 1;
          const nodeScale = 0.92 + 0.08 * nodeProgress;
          const fill =
            kind === "start" || kind === "end" ? success : surface;
          const stroke =
            kind === "decision"
              ? accentAlt
              : kind === "start" || kind === "end"
                ? success
                : accent;
          const textColor =
            kind === "start" || kind === "end" ? onAccent : onSurface;
          // Per-kind geometry.
          let shape: ReactElement;
          if (kind === "decision") {
            // Diamond. Width/height same as the process rectangle so
            // edges still anchor on the same axis.
            const cx = NODE_W / 2;
            const cy = NODE_H / 2;
            const r = Math.min(NODE_W, NODE_H) / 2;
            shape = (
              <polygon
                points={`${cx},0 ${NODE_W},${cy} ${cx},${NODE_H} 0,${cy}`}
                fill={fill}
                stroke={stroke}
                strokeWidth={3}
              />
            );
          } else if (kind === "start" || kind === "end") {
            // Pill — fully rounded short rectangle. Pulls half the
            // node width so the eye reads it as a "terminal" node.
            const pillW = NODE_W;
            const pillH = PILL_H;
            const pillY = (NODE_H - pillH) / 2;
            shape = (
              <rect
                x={0}
                y={pillY}
                width={pillW}
                height={pillH}
                rx={pillH / 2}
                fill={fill}
                stroke={stroke}
                strokeWidth={3}
              />
            );
          } else {
            // process — rounded rectangle
            shape = (
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={NODE_RX}
                fill={fill}
                stroke={stroke}
                strokeWidth={3}
              />
            );
          }
          return (
            <g
              key={`node-${i}`}
              transform={`translate(${p.x},${p.y}) scale(${nodeScale})`}
              opacity={hasAnimations ? nodeProgress : 1}
              filter="url(#flow-shadow)"
            >
              {shape}
              <text
                x={NODE_W / 2}
                y={NODE_H / 2}
                fill={textColor}
                fontSize={FONT_PX}
                fontWeight={FONT_WEIGHT_NODE}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily={theme.typography.body.fontFamily}
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
