import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface PyramidLevel {
  label: string;
  /** Optional one-word badge on the left side of the level — used for
   *  short role tags like "基础" / "流程" / "目标". Falls back to the
   *  level's 1-based index ("L1", "L2", …) when omitted. */
  role?: string;
  /** Optional small icon rendered to the right of the level. */
  icon?: string;
}

export interface PyramidDiagramProps {
  theme?: Theme;
  /** Levels top-first: `levels[0]` is the pyramid's apex. Rendering is
   *  bottom-up (foundation lands first). Accepts plain strings
   *  (back-compat — renders as before) or `PyramidLevel` objects with
   *  optional `role` / `icon` for richer treatment. */
  levels: (string | PyramidLevel)[];
  /** Optional headline rendered above the apex. */
  title?: string;
  /** v0.4.2 — `level-${i}` fades each trapezoid in, bottom-up. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const TOP_W = 280;
const BASE_W = 1480;
const APEX_Y = 200;
const BASE_Y = 920;
const CENTER_X = 960;

/** How tall the apex apex peak is. The apex is rendered as a separate
 *  triangle on top of the trapezoid stack to give the "summit" a visual
 *  identity rather than just the top of a trapezoid. */
const APEX_H = 70;

export const PyramidDiagram: FC<PyramidDiagramProps> = ({
  theme = darkTechTheme,
  levels = [],
  title,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  // Normalize legacy string[] to the new typed shape.
  const typed: PyramidLevel[] = levels.slice(0, 6).map((l) =>
    typeof l === "string" ? { label: l } : l,
  );
  const n = typed.length;
  // Each level has equal height; total stacked-height spans BASE_Y - APEX_Y
  // so the apex peak sits above the trapezoid stack, not overlapping.
  const stackTop = APEX_Y + APEX_H + 8; // small gap between apex and top trapezoid
  const stackBottom = BASE_Y;
  const levelH = n > 0 ? (stackBottom - stackTop) / n : 0;
  // Width interpolates linearly from the topmost trapezoid to the base.
  const widthAt = (k: number): number =>
    TOP_W + ((BASE_W - TOP_W) * k) / Math.max(1, n);

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
          {/* Soft drop shadow for the foundation tier — gives the
              widest layer a sense of weight without making it look
              heavy. */}
          <filter id="pyramid-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="6" />
            <feOffset dx="0" dy="4" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.16" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Slight vertical gradient for each trapezoid — top is
              more saturated, bottom fades toward a softer hue, so the
              pyramid reads as rising. The gradient is on each level
              individually to keep the "growth" reading strong. */}
          <linearGradient id="pyramid-tier-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.colors.accent} stopOpacity="0.85" />
            <stop offset="100%" stopColor={theme.colors.accent} stopOpacity="0.45" />
          </linearGradient>
          {/* Slightly darker gradient for the foundation — a strong,
              saturated "rock" that everything else rests on. */}
          <linearGradient id="pyramid-foundation-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.colors.accent} stopOpacity="0.95" />
            <stop offset="100%" stopColor={theme.colors.accent} stopOpacity="0.7" />
          </linearGradient>
        </defs>

        {/* Optional headline — centered above the apex, with a thin
            accent underline. Drawn first so the trapezoids can
            overlap it if the user provides an unusually long title. */}
        {title !== undefined ? (
          <g>
            <text
              x={CENTER_X}
              y={APEX_Y - 90}
              fill={theme.colors.primary}
              fontSize={44}
              fontWeight={700}
              textAnchor="middle"
              fontFamily={theme.typography.subtitle.fontFamily}
            >
              {title}
            </text>
            <line
              x1={CENTER_X - 60}
              y1={APEX_Y - 70}
              x2={CENTER_X + 60}
              y2={APEX_Y - 70}
              stroke={theme.colors.accent}
              strokeWidth={3}
              strokeLinecap="round"
            />
          </g>
        ) : null}

        {/* Apex peak — a triangle that sits above the topmost trapezoid
            to give the "summit" its own visual identity. The triangle
            is the same accent but slightly darker so it reads as the
            focal point. */}
        {n > 0 ? (
          <g
            opacity={hasAnimations ? progressFor(animations, "level-0", sceneSec, 0.5) : fade(frame, 20)}
            filter="url(#pyramid-shadow)"
          >
            <polygon
              points={`${CENTER_X},${APEX_Y} ${CENTER_X + TOP_W / 2},${APEX_Y + APEX_H} ${CENTER_X - TOP_W / 2},${APEX_Y + APEX_H}`}
              fill="url(#pyramid-foundation-grad)"
              stroke={theme.colors.accent}
              strokeWidth={3}
            />
            {/* Small "summit" star/asterisk marker at the peak —
                a tiny dot so the eye lands on the apex first. */}
            <circle
              cx={CENTER_X}
              cy={APEX_Y + 8}
              r={4}
              fill={theme.colors.background}
              opacity={0.9}
            />
          </g>
        ) : null}

        {/* Foundation slab — a wide, darker rectangle under the base
            trapezoid, suggesting the "ground" the pyramid sits on.
            Only rendered when the base width is large enough. */}
        {n > 0 ? (
          <g
            opacity={hasAnimations
              ? progressFor(animations, "level-0", sceneSec, 0.5) * 0.7
              : fade(frame, 30)}
          >
            <rect
              x={CENTER_X - BASE_W / 2 - 30}
              y={stackBottom + 4}
              width={BASE_W + 60}
              height={14}
              rx={7}
              fill={theme.colors.primary}
              opacity={0.18}
            />
            <rect
              x={CENTER_X - BASE_W / 2 - 18}
              y={stackBottom + 22}
              width={BASE_W + 36}
              height={3}
              rx={1.5}
              fill={theme.colors.primary}
              opacity={0.12}
            />
          </g>
        ) : null}

        {typed.map((lvl, i) => {
          const kTop = i;
          const kBot = i + 1;
          const yTop = stackTop + kTop * levelH;
          const yBot = stackTop + kBot * levelH;
          const wTop = widthAt(kTop);
          const wBot = widthAt(kBot);
          // Bottom-up entrance: the deepest level animates first.
          const order = n - 1 - i;
          const p = hasAnimations
            ? progressFor(animations, `level-${i}`, sceneSec, 0.5)
            : fade(frame - order * 8, 20);
          // Highlight the foundation (deepest) tier a touch with the
          // darker "rock" gradient; upper tiers use the lighter one.
          const isFoundation = i === n - 1;
          const grad = isFoundation
            ? "url(#pyramid-foundation-grad)"
            : "url(#pyramid-tier-grad)";
          // Level row label: optional role string on the left of the
          // trapezoid, with a tick connector to the tier. Falls back
          // to a numbered index.
          const role = lvl.role ?? `L${i + 1}`;
          return (
            <g key={`level-${i}`} opacity={p} filter="url(#pyramid-shadow)">
              {/* Trapezoid body. Use a polygon so the next layer
                  stacks cleanly on top. */}
              <polygon
                points={[
                  `${CENTER_X - wTop / 2},${yTop}`,
                  `${CENTER_X + wTop / 2},${yTop}`,
                  `${CENTER_X + wBot / 2},${yBot}`,
                  `${CENTER_X - wBot / 2},${yBot}`,
                ].join(" ")}
                fill={grad}
                stroke={theme.colors.accent}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {/* Inner divider line at the top edge of each tier —
                  makes the "stacked layers" reading strong. */}
              <line
                x1={CENTER_X - wTop / 2 + 4}
                y1={yTop + 1}
                x2={CENTER_X + wTop / 2 - 4}
                y2={yTop + 1}
                stroke={theme.colors.accent}
                strokeWidth={1.5}
                opacity={0.6}
              />
              {/* Centered label inside the tier. */}
              <text
                x={CENTER_X}
                y={(yTop + yBot) / 2 + 2}
                fill={theme.colors.primary}
                fontSize={Math.min(36, levelH * 0.42)}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily={theme.typography.subtitle.fontFamily}
              >
                {lvl.label}
              </text>
              {/* Optional icon — small monogram on the right of the
                  tier. Falls back to a default dot if icon is omitted. */}
              {lvl.icon !== undefined ? (
                <g transform={`translate(${CENTER_X + wTop / 2 + 30}, ${(yTop + yBot) / 2})`}>
                  <circle
                    r={18}
                    fill={theme.colors.background}
                    stroke={theme.colors.accent}
                    strokeWidth={2}
                  />
                  <text
                    x={0}
                    y={1}
                    fill={theme.colors.accent}
                    fontSize={20}
                    fontWeight={700}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontFamily={theme.typography.body.fontFamily}
                  >
                    {lvl.icon.charAt(0).toUpperCase()}
                  </text>
                </g>
              ) : null}
              {/* Role tag — small chip on the left of the tier, with
                  a short tick connecting to the trapezoid edge. */}
              <g>
                <line
                  x1={CENTER_X - wBot / 2 - 8}
                  y1={(yTop + yBot) / 2}
                  x2={CENTER_X - wBot / 2 - 36}
                  y2={(yTop + yBot) / 2}
                  stroke={theme.colors.accent}
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                  opacity={0.55}
                />
                <rect
                  x={CENTER_X - wBot / 2 - 36 - 8 - role.length * 14}
                  y={(yTop + yBot) / 2 - 16}
                  width={role.length * 14 + 16}
                  height={32}
                  rx={16}
                  fill={theme.colors.surface}
                  stroke={theme.colors.accent}
                  strokeWidth={1.5}
                />
                <text
                  x={CENTER_X - wBot / 2 - 36 - role.length * 7}
                  y={(yTop + yBot) / 2 + 1}
                  fill={theme.colors.primary}
                  fontSize={18}
                  fontWeight={600}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontFamily={theme.typography.body.fontFamily}
                >
                  {role}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
