import { z } from "zod";
import { darkTechTheme } from "../theme.js";
import {
  elementProgress,
  resolveCameraTransform,
  resolveElementTiming,
  type SceneElementRef,
} from "./svgSceneLogic.js";

/**
 * SvgScene — whiteboard/diagram scenes (plan T4.3, §9 renderer abstraction).
 * `visual.renderer: "svg"` + `visual.component: "SvgScene"` renders a
 * structured diagram spec (nodes + edges) on the theme background, with
 * SVG stroke draw-on driven by the scene's `animations[]` timeline; scenes
 * without explicit animations draw on sequentially (nodes then edges).
 * Remotion stays the rendering runtime (§2.1) — "svg" selects the scene
 * content family, not a different pipeline.
 */

export const SvgScenePropsSchema = z
  .object({
    title: z.string().optional(),
    nodes: z
      .array(
        z
          .object({
            id: z.string().min(1),
            kind: z.enum(["rect", "circle", "label"]).default("rect"),
            x: z.number(),
            y: z.number(),
            w: z.number().default(360),
            h: z.number().default(140),
            text: z.string().optional(),
            fill: z.string().optional(),
          })
          .passthrough(),
      )
      .min(1),
    edges: z
      .array(
        z
          .object({
            id: z.string().min(1),
            from: z.string().min(1),
            to: z.string().min(1),
            label: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export type SvgSceneProps = {
  frame: number;
  durationInFrames: number;
  animations?: {
    id: string;
    target: string;
    type: string;
    start: number;
    duration: number;
    easing: string;
  }[];
} & z.infer<typeof SvgScenePropsSchema>;

const CANVAS_W = 1920;
const CANVAS_H = 1080;

export const SvgScene = (props: SvgSceneProps) => {
  // Raw props (the zod defaults don't apply at this boundary) — guard
  // everything that would crash on undefined.
  const {
    frame,
    durationInFrames,
    animations = [],
    title,
    nodes = [],
    edges = [],
  } = props;
  const fps = (props as { fps?: number }).fps ?? 30;
  const durationSec = durationInFrames / fps;

  const elements: SceneElementRef[] = [
    ...nodes.map((n, i) => ({ id: n.id, kind: "node" as const, order: i })),
    ...edges.map((e, i) => ({ id: e.id, kind: "edge" as const, order: i })),
  ];
  const timing = resolveElementTiming(animations, elements, durationSec, fps);

  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const p = (id: string) => {
    const t = timing.get(id);
    if (!t) return 0;
    return elementProgress(t, frame, fps);
  };

  // Target-driven camera (T7.4): type "camera" animations focus a node.
  const camera = resolveCameraTransform(
    animations,
    nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h })),
    frame,
    fps,
    CANVAS_W,
    CANVAS_H,
  );
  const cameraTransform =
    camera.scale !== 1
      ? `translate(${camera.tx.toFixed(2)} ${camera.ty.toFixed(2)}) scale(${camera.scale.toFixed(4)})`
      : undefined;

  return (
    <svg
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    >
      <g transform={cameraTransform}>
      {title ? (
        <text
          x={80}
          y={110}
          fill={darkTechTheme.colors.primary}
          fontSize={52}
          fontFamily={darkTechTheme.typography.title.fontFamily}
          fontWeight={700}
        >
          {title}
        </text>
      ) : null}

      {/* edges first so nodes overlap their endpoints */}
      {edges.map((edge) => {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        if (!from || !to) return null;
        const t = timing.get(edge.id);
        const prog = p(edge.id);
        const x1 = from.x + from.w / 2;
        const y1 = from.y + from.h / 2;
        const x2 = to.x + to.w / 2;
        const y2 = to.y + to.h / 2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const trim = 0.18; // stop short of the node centers
        const ex = x1 + dx * (1 - trim);
        const ey = y1 + dy * (1 - trim);
        const headOpacity = prog > 0.9 ? 1 : 0;
        return (
          <g key={edge.id}>
            <line
              x1={x1}
              y1={y1}
              x2={ex}
              y2={ey}
              stroke={darkTechTheme.colors.accent}
              strokeWidth={6}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - prog}
            />
            <polygon
              points={`${ex},${ey} ${ex - dx / len * 34 - dy / len * 16},${ey - dy / len * 34 + dx / len * 16} ${ex - dx / len * 34 + dy / len * 16},${ey - dy / len * 34 - dx / len * 16}`}
              fill={darkTechTheme.colors.accent}
              opacity={headOpacity}
            />
            {edge.label && t ? (
              <text
                x={(x1 + ex) / 2}
                y={(y1 + ey) / 2 - 18}
                fill={darkTechTheme.colors.secondary}
                fontSize={38}
                textAnchor="middle"
                opacity={Math.min(1, Math.max(0, prog * 1.4 - 0.4))}
              >
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {nodes.map((node) => {
        const prog = p(node.id);
        const t = timing.get(node.id);
        const fill = node.fill ?? darkTechTheme.colors.surface;
        const stroke = darkTechTheme.colors.primary;
        const common = {
          x: node.x,
          y: node.y,
          width: node.w,
          height: node.h,
          fill,
          stroke,
          strokeWidth: 5,
          rx: node.kind === "circle" ? Math.min(node.w, node.h) / 2 : 18,
          pathLength: 1,
          strokeDasharray: 1,
          strokeDashoffset: 1 - prog,
          fillOpacity: prog,
        };
        const isHighlight =
          t?.type === "highlight" &&
          frame / fps >= t.start &&
          frame / fps <= t.start + t.duration;
        return (
          <g key={node.id}>
            {node.kind === "circle" ? (
              <ellipse cx={node.x + node.w / 2} cy={node.y + node.h / 2} rx={node.w / 2} ry={node.h / 2} {...ellipseProps(common)} />
            ) : (
              <rect {...common} />
            )}
            {isHighlight ? (
              <rect
                x={node.x - 14}
                y={node.y - 14}
                width={node.w + 28}
                height={node.h + 28}
                fill="none"
                stroke={darkTechTheme.colors.warning}
                strokeWidth={8}
                rx={24}
                opacity={0.9}
              />
            ) : null}
            {node.text ? (
              <text
                x={node.x + node.w / 2}
                y={node.y + node.h / 2 + 14}
                fill={darkTechTheme.colors.primary}
                fontSize={44}
                textAnchor="middle"
                fontFamily={darkTechTheme.typography.body.fontFamily}
                opacity={Math.min(1, prog * 1.3)}
              >
                {node.text}
              </text>
            ) : null}
          </g>
        );
      })}
      </g>
    </svg>
  );
};

/** rect/ellipse share styling; ellipse ignores x/y/w/h in favor of cx/cy/r. */
function ellipseProps(common: {
  fill: string;
  stroke: string;
  strokeWidth: number;
  pathLength: number;
  strokeDasharray: number;
  strokeDashoffset: number;
  fillOpacity: number;
}) {
  const { fill, stroke, strokeWidth, pathLength, strokeDasharray, strokeDashoffset, fillOpacity } = common;
  return { fill, stroke, strokeWidth, pathLength, strokeDasharray, strokeDashoffset, fillOpacity };
}
