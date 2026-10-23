import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface MapLandform {
  /** SVG `d` attribute — the landform outline (river, mountain ridge,
   *  plain). Coordinates in 0-1000 viewBox space. */
  d: string;
  kind?: "ridge" | "river" | "plain";
  /** Optional label rendered near the landform. */
  label?: string;
}

export interface MapRoute {
  d: string;
  /** Optional label rendered near the route midpoint. */
  label?: string;
  /** Optional accent color override; defaults to theme.accent. */
  color?: string;
}

export interface MapMarker {
  x: number;
  y: number;
  kind?: "start" | "city" | "battle";
  label?: string;
}

export interface MapInsertProps {
  theme?: Theme;
  landforms?: MapLandform[];
  routes?: MapRoute[];
  markers?: MapMarker[];
  /** Optional title rendered at the top. */
  title?: string;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const VIEW = 1000;
const W = 1080;
const H = 700;

/** Simple map composition. Landform outlines (rivers / ridges / plains)
 *  form the base; routes (curved or straight) overlay on top; markers
 *  pin landmarks. Markers use the same color/icon language as the
 *  rest of the system so a `start` marker reads as "where the journey
 *  begins" without needing a legend. */
export const MapInsert: FC<MapInsertProps> = ({
  theme = darkTechTheme,
  landforms = [],
  routes = [],
  markers = [],
  title,
  frame,
}) => {
  const opacity = fade(frame);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "transparent",
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        {title !== undefined ? (
          <div
            style={{
              fontSize: 36,
              fontWeight: 700,
              color: theme.colors.primary,
              fontFamily: theme.typography.subtitle.fontFamily,
            }}
          >
            {title}
          </div>
        ) : null}
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${VIEW} ${VIEW * H / W}`}
        >
          <defs>
            {/* Subtle paper texture — a soft tan gradient that the
                landforms sit on. Keeps the map from looking like a
                flat-shape diagram. */}
            <linearGradient id="map-paper" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.colors.surface} />
              <stop offset="100%" stopColor={theme.colors.background} />
            </linearGradient>
            <pattern
              id="map-grid"
              width={50}
              height={50}
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 50 0 L 0 0 0 50"
                fill="none"
                stroke={theme.colors.secondary}
                strokeOpacity={0.18}
                strokeWidth={1}
              />
            </pattern>
            <filter id="map-shadow" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
              <feOffset dx="0" dy="2" result="offsetblur" />
              <feComponentTransfer>
                <feFuncA type="linear" slope="0.18" />
              </feComponentTransfer>
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Paper background — the soft tan field. */}
          <rect
            x={0}
            y={0}
            width={VIEW}
            height={VIEW * H / W}
            fill="url(#map-paper)"
            stroke={theme.colors.secondary}
            strokeOpacity={0.5}
            strokeWidth={2}
            rx={8}
          />
          {/* Faint reference grid — reads as a paper atlas. */}
          <rect
            x={0}
            y={0}
            width={VIEW}
            height={VIEW * H / W}
            fill="url(#map-grid)"
            rx={8}
          />
          {/* Landforms (rivers / ridges / plains). Drawn before routes
              so routes sit on top. */}
          {landforms.map((l, i) => {
            const fill = (() => {
              switch (l.kind) {
                case "ridge":
                  return theme.colors.secondary + "33";
                case "river":
                  return theme.colors.accent + "55";
                case "plain":
                  return theme.colors.success + "22";
                default:
                  return theme.colors.secondary + "22";
              }
            })();
            const stroke = (() => {
              switch (l.kind) {
                case "river":
                  return theme.colors.accent;
                default:
                  return theme.colors.secondary;
              }
            })();
            return (
              <g key={`landform-${i}`}>
                <path
                  d={l.d}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={l.kind === "river" ? 3 : 1.5}
                />
                {l.label !== undefined ? (
                  <text
                    fill={stroke}
                    fontSize={18}
                    fontFamily={theme.typography.body.fontFamily}
                  >
                    <textPath
                      href={`#map-landform-${i}`}
                      startOffset="5%"
                    >
                      {l.label}
                    </textPath>
                  </text>
                ) : null}
              </g>
            );
          })}
          {/* Routes — drawn after landforms so they sit on top.
              Each route can have a label rendered at the midpoint. */}
          {routes.map((r, i) => (
            <g key={`route-${i}`}>
              <path
                id={`map-route-${i}`}
                d={r.d}
                fill="none"
                stroke={r.color ?? theme.colors.accent}
                strokeWidth={4}
                strokeLinecap="round"
                strokeDasharray="2 0"
                filter="url(#map-shadow)"
              />
              {r.label !== undefined ? (
                <text
                  fill={r.color ?? theme.colors.accent}
                  fontSize={20}
                  fontWeight={700}
                  fontFamily={theme.typography.subtitle.fontFamily}
                  stroke={theme.colors.background}
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  <textPath
                    href={`#map-route-${i}`}
                    startOffset="50%"
                    textAnchor="middle"
                  >
                    {r.label}
                  </textPath>
                </text>
              ) : null}
            </g>
          ))}
          {/* Markers — pin landmarks with a small label and a kind-
              specific icon. */}
          {markers.map((m, i) => {
            const color = (() => {
              switch (m.kind) {
                case "start":
                  return theme.colors.success;
                case "battle":
                  return theme.colors.warning;
                case "city":
                default:
                  return theme.colors.accent;
              }
            })();
            const symbol = (() => {
              switch (m.kind) {
                case "start":
                  return "▲";
                case "battle":
                  return "✕";
                case "city":
                default:
                  return "●";
              }
            })();
            return (
              <g key={`marker-${i}`} transform={`translate(${m.x}, ${m.y})`}>
                <circle
                  r={18}
                  fill={theme.colors.surface}
                  stroke={color}
                  strokeWidth={3}
                  filter="url(#map-shadow)"
                />
                <text
                  x={0}
                  y={6}
                  fill={color}
                  fontSize={20}
                  fontWeight={700}
                  textAnchor="middle"
                  fontFamily={theme.typography.subtitle.fontFamily}
                >
                  {symbol}
                </text>
                {m.label !== undefined ? (
                  <text
                    x={0}
                    y={-26}
                    fill={theme.colors.primary}
                    fontSize={16}
                    fontWeight={600}
                    textAnchor="middle"
                    fontFamily={theme.typography.body.fontFamily}
                    stroke={theme.colors.background}
                    strokeWidth={2.5}
                    paintOrder="stroke"
                  >
                    {m.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </AbsoluteFill>
  );
};
