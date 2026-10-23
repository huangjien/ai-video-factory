import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface VennSet {
  label: string;
  /** Optional short description rendered under the label. */
  detail?: string;
}

export interface VennDiagramProps {
  theme?: Theme;
  /** 1–3 set names. Extra sets are dropped. */
  sets: (string | VennSet)[];
  /** Optional label rendered in the shared intersection. */
  center?: string;
  /** v0.4.2 — `set-${i}` fades each circle in. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const SET_COLORS = ["accent", "warning", "success"] as const;

function pickColor(theme: Theme, kind: (typeof SET_COLORS)[number]): string {
  return kind === "accent"
    ? theme.colors.accent
    : kind === "warning"
      ? theme.colors.warning
      : theme.colors.success;
}

/** Two- or three-set Venn diagram. Each set uses a different theme pop
 *  color at low fill opacity so the overlap region reads as a deeper,
 *  richer blend. Set labels float above each circle; the center label
 *  sits in the intersection. */
export const VennDiagram: FC<VennDiagramProps> = ({
  theme = darkTechTheme,
  sets = [],
  center,
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  // Normalize legacy string[] to the new typed shape.
  const typed: VennSet[] = sets.slice(0, 3).map((s) =>
    typeof s === "string" ? { label: s } : s,
  );
  // Circle positions on a 1920×1080 canvas. Center biased to leave the
  // upper third for the label and the lower third for breathing room.
  const CX = 960;
  const CY = 600;
  // Offset between the two main circle centers — sized so the
  // overlap is roughly 30% of each circle's area, which reads as a
  // "Venn overlap" rather than "concentric".
  const R = 280;
  const D = 200;
  const positions: Array<{ x: number; y: number; color: string }> = [
    { x: CX - D / 2, y: CY, color: pickColor(theme, "accent") },
    { x: CX + D / 2, y: CY, color: pickColor(theme, "warning") },
    { x: CX, y: CY - 110, color: pickColor(theme, "success") },
  ];
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
          <filter id="venn-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="6" />
            <feOffset dx="0" dy="4" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.15" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {typed.map((s, i) => {
          const p = positions[i];
          if (!p) return null;
          const setProgress = hasAnimations
            ? progressFor(animations, `set-${i}`, sceneSec, 0.5)
            : fade(frame - i * 6, 18);
          return (
            <g key={`set-${i}`} opacity={setProgress} filter="url(#venn-shadow)">
              <circle
                cx={p.x}
                cy={p.y}
                r={R}
                fill={p.color}
                fillOpacity={0.18}
                stroke={p.color}
                strokeWidth={3}
              />
            </g>
          );
        })}

        {/* Set labels — sit just above the corresponding circle. The
            label reads as the circle's "name" and the detail as a
            short expansion underneath. */}
        {typed.map((s, i) => {
          const p = positions[i];
          if (!p) return null;
          const labelY = i < 2 ? p.y + R + 50 : p.y - R - 50;
          // Three-set configuration: the top circle's label sits
          // above its arc; the side circles' labels sit below theirs.
          return (
            <g key={`label-${i}`} opacity={hasAnimations ? 1 : 1}>
              <text
                x={p.x}
                y={labelY}
                fill={p.color}
                fontSize={28}
                fontWeight={700}
                textAnchor="middle"
                fontFamily={theme.typography.subtitle.fontFamily}
              >
                {s.label}
              </text>
              {s.detail !== undefined ? (
                <text
                  x={p.x}
                  y={labelY + 26}
                  fill={theme.colors.secondary}
                  fontSize={18}
                  textAnchor="middle"
                  fontFamily={theme.typography.body.fontFamily}
                >
                  {s.detail}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Center label — the intersection, in a soft white pill so
            it reads against the overlap regardless of which colors
            are blending. */}
        {center !== undefined ? (
          <g>
            <rect
              x={CX - 80}
              y={CY - 18}
              width={160}
              height={36}
              rx={18}
              fill={theme.colors.surface}
              opacity={0.94}
              stroke={theme.colors.accent}
              strokeWidth={1.5}
            />
            <text
              x={CX}
              y={CY + 6}
              fill={theme.colors.accent}
              fontSize={20}
              fontWeight={700}
              textAnchor="middle"
              fontFamily={theme.typography.subtitle.fontFamily}
            >
              {center}
            </text>
          </g>
        ) : null}
      </svg>
    </AbsoluteFill>
  );
};
