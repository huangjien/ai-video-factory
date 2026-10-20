import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { darkTechTheme, type Theme } from "../theme.js";

export interface MapInsertProps {
  theme?: Theme;
  /**
   * Simplified landforms as SVG path data in the 1920×1080 viewBox. Kept
   * deliberately coarse — a few ridges and rivers, not terrain. The plan
   * (CS-14) forbids 细碎地形 precisely because a generative map that
   * invents geography misleads.
   */
  landforms?: { d: string; kind?: "ridge" | "river" | "plain" }[];
  /** March routes as path data. */
  routes?: { d: string }[];
  /**
   * Markers. `kind` picks a SHAPE and a colour, never a glyph: a battle
   * site is a ring, a city a square. Place names are spoken by the
   * narrator — there is no text field anywhere in these props, so a
   * readable place name is not representable here (CS-14: 禁止可读地名).
   */
  markers?: { x: number; y: number; kind?: "start" | "city" | "battle" }[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** Gongbi line colours: ink for structure, two low-saturation tints for
 *  water and ridge, one accent for the markers that matter. */
const RIDGE = "#77786F";
const RIVER = "#657B78";
const PLAIN = "#B38A56";

/**
 * Single full-frame map insert (CS-14).
 *
 * One continuous frame — never a grid, a panel pair or a comic page. The
 * renderer draws the geometry from structured, reviewable data rather
 * than asking an image model for a map, because a generated map invents
 * terrain and puts pseudo-writing on it. Everything here is a vector, so
 * the directions shown can be checked against a source before render.
 */
export const MapInsert: FC<MapInsertProps> = ({
  theme = darkTechTheme,
  landforms = [],
  routes = [],
  markers = [],
  frame,
}) => {
  const ink = theme.colors.primary;
  const accent = theme.colors.accent;
  // Draw-on: one slow reveal, so the map reads as drawn rather than
  // pasted in. CS-09's still-first profile is unaffected — this is the
  // component's own entrance, not a stacked scene animation.
  const progress = Math.max(0, Math.min(1, frame / 30 / 1.6));

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 1920 1080"
        role="img"
        aria-label="战役路线示意"
      >
        {landforms.map((l, i) => (
          <path
            key={`lf-${i}`}
            d={l.d}
            fill={l.kind === "plain" ? PLAIN : "none"}
            fillOpacity={l.kind === "plain" ? 0.16 : 0}
            stroke={l.kind === "river" ? RIVER : RIDGE}
            strokeWidth={l.kind === "river" ? 3 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - progress}
          />
        ))}
        {routes.map((r, i) => (
          <path
            key={`rt-${i}`}
            d={r.d}
            fill="none"
            stroke={ink}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray="14 12"
          />
        ))}
        {markers.map((m, i) =>
          m.kind === "battle" ? (
            <circle
              key={`mk-${i}`}
              cx={m.x}
              cy={m.y}
              r={16}
              fill="none"
              stroke={accent}
              strokeWidth={5}
              opacity={progress}
            />
          ) : (
            <rect
              key={`mk-${i}`}
              x={m.x - 13}
              y={m.y - 13}
              width={26}
              height={26}
              fill={m.kind === "start" ? ink : "none"}
              stroke={m.kind === "start" ? "none" : ink}
              strokeWidth={4}
              opacity={progress}
            />
          ),
        )}
      </svg>
    </AbsoluteFill>
  );
};