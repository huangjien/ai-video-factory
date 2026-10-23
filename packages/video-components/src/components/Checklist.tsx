import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

/** A single item on the checklist. Back-compat: the original component
 *  accepted `string` for `text`; this object form adds `description`,
 *  `status`, and `group` for a richer treatment. */
export interface ChecklistItem {
  text: string;
  description?: string;
  /** Item state. `done` shows a green checkmark; `pending` an open
   *  ring; `skip` a dashed grey ring. Defaults to `done` (the legacy
   *  rendering was "everything checked"). */
  status?: "done" | "pending" | "skip";
  /** Optional short group tag rendered on the right (e.g. "基础" /
   *  "流程"). Used to cluster related items. */
  group?: string;
}

export interface ChecklistProps {
  theme?: Theme;
  /** Back-compat: string[] is treated as all-done items. New callers
   *  pass ChecklistItem[]. */
  items: (string | ChecklistItem)[];
  /** Optional title rendered above the list. */
  title?: string;
  /** v0.4.2 — `item-${i}` pops each check mark and fades its text in. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** Returns the CSS color for an item's status marker + body. */
function statusColor(
  theme: Theme,
  status: ChecklistItem["status"],
): { mark: string; body: string; ring: string; fill: string } {
  switch (status) {
    case "skip":
      return {
        mark: theme.colors.secondary,
        body: theme.colors.secondary,
        ring: theme.colors.secondary,
        fill: "transparent",
      };
    case "pending":
      return {
        mark: theme.colors.accent,
        body: theme.colors.primary,
        ring: theme.colors.accent,
        fill: "transparent",
      };
    case "done":
    case undefined:
    default:
      return {
        mark: theme.colors.success,
        body: theme.colors.primary,
        ring: theme.colors.success,
        fill: theme.colors.success,
      };
  }
}

export const Checklist: FC<ChecklistProps> = ({
  theme = darkTechTheme,
  items = [],
  title,
  animations,
  frame,
  durationInFrames,
}) => {
  // Normalize legacy string[] to the new typed shape.
  const typed: ChecklistItem[] = items.map((i) =>
    typeof i === "string" ? { text: i } : i,
  );
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec = durationInFrames > 0 ? frame / 30 : 0;
  const done = typed.filter((i) => !i.status || i.status === "done").length;
  const total = typed.length;
  // Layout — cards stack vertically. CARD_W matches a comfortable read-
  // width; row spacing adds breathing room between cards.
  const CARD_W = 1100;
  const ROW_GAP = 16;
  const HEADER_H = title !== undefined ? 90 : 0;
  const PROGRESS_H = 56;
  const ROW_H = 88;
  const innerLeft = (1920 - CARD_W) / 2;
  const innerTop = (1080 - (HEADER_H + typed.length * ROW_H + (typed.length - 1) * ROW_GAP + PROGRESS_H)) / 2;

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
          <filter id="checklist-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="4" />
            <feOffset dx="0" dy="2" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.12" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Title — bold, centered, with a thin accent underline. */}
        {title !== undefined ? (
          <g>
            <text
              x={960}
              y={innerTop + 36}
              fill={theme.colors.primary}
              fontSize={44}
              fontWeight={700}
              textAnchor="middle"
              fontFamily={theme.typography.subtitle.fontFamily}
            >
              {title}
            </text>
            <line
              x1={900}
              y1={innerTop + 60}
              x2={1020}
              y2={innerTop + 60}
              stroke={theme.colors.accent}
              strokeWidth={3}
              strokeLinecap="round"
            />
          </g>
        ) : null}

        {typed.map((it, i) => {
          const rowY = innerTop + HEADER_H + i * (ROW_H + ROW_GAP);
          const itemProgress = hasAnimations
            ? progressFor(animations, `item-${i}`, sceneSec, 0.5)
            : fade(frame - i * 4, 16);
          const c = statusColor(theme, it.status);
          // For done status, the ring fills via a separate small inset
          // square — the checkmark draws on top.
          const showCheck = it.status === undefined || it.status === "done";
          return (
            <g key={`item-${i}`} opacity={itemProgress} filter="url(#checklist-shadow)">
              {/* Card — translucent surface with status-tinted left border
                  and a subtle drop shadow. The card stretches the full
                  ROW_H so even single-line descriptions read comfortably. */}
              <rect
                x={innerLeft}
                y={rowY}
                width={CARD_W}
                height={ROW_H}
                rx={12}
                fill={theme.colors.surface}
                opacity={0.88}
                stroke={c.ring}
                strokeWidth={1.5}
              />
              {/* Left accent bar — thicker than the rest of the border
                  so the status color reads as a label stripe. */}
              <rect
                x={innerLeft}
                y={rowY}
                width={8}
                height={ROW_H}
                rx={3}
                fill={c.ring}
              />
              {/* Status marker — an SVG circle with an inset white
                  checkmark (for "done") or hollow ring (for "pending")
                  or dashed ring (for "skip"). Sized so it reads even at
                  the upper-third of a 1920×1080 frame. */}
              <g transform={`translate(${innerLeft + 50}, ${rowY + ROW_H / 2})`}>
                <circle
                  r={22}
                  fill={c.fill}
                  stroke={c.ring}
                  strokeWidth={3}
                  strokeDasharray={it.status === "skip" ? "4 4" : undefined}
                />
                {showCheck ? (
                  <path
                    d="M -8 0 L -2 6 L 8 -6"
                    fill="none"
                    stroke={c.mark === theme.colors.success ? "#FFFFFF" : c.mark}
                    strokeWidth={3.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : it.status === "pending" ? (
                  <circle r={4} fill={c.ring} />
                ) : null}
              </g>
              {/* Primary text */}
              <text
                x={innerLeft + 90}
                y={rowY + (it.description !== undefined ? 36 : ROW_H / 2 + 6)}
                fill={c.body}
                fontSize={it.description !== undefined ? 28 : 30}
                fontWeight={it.status === "pending" ? 500 : 600}
                fontFamily={theme.typography.subtitle.fontFamily}
              >
                {it.text}
              </text>
              {/* Optional secondary description (smaller, muted). */}
              {it.description !== undefined ? (
                <text
                  x={innerLeft + 90}
                  y={rowY + 64}
                  fill={theme.colors.secondary}
                  fontSize={20}
                  fontFamily={theme.typography.body.fontFamily}
                >
                  {it.description}
                </text>
              ) : null}
              {/* Optional group chip on the right. */}
              {it.group !== undefined ? (
                <g>
                  <rect
                    x={innerLeft + CARD_W - 100}
                    y={rowY + ROW_H / 2 - 16}
                    width={84}
                    height={32}
                    rx={16}
                    fill={theme.colors.background}
                    stroke={theme.colors.accent}
                    strokeWidth={1.5}
                    opacity={0.9}
                  />
                  <text
                    x={innerLeft + CARD_W - 58}
                    y={rowY + ROW_H / 2 + 5}
                    fill={theme.colors.accent}
                    fontSize={16}
                    fontWeight={600}
                    textAnchor="middle"
                    fontFamily={theme.typography.body.fontFamily}
                  >
                    {it.group}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}

        {/* Progress bar — a thin track across the full card width, with
            a colored fill that grows as more items are completed. */}
        {total > 0 ? (
          <g transform={`translate(${innerLeft}, ${innerTop + HEADER_H + typed.length * (ROW_H + ROW_GAP) + 4})`}>
            <text
              x={0}
              y={-4}
              fill={theme.colors.secondary}
              fontSize={18}
              fontFamily={theme.typography.body.fontFamily}
            >
              完成 {done} / {total}
            </text>
            <text
              x={CARD_W}
              y={-4}
              fill={theme.colors.secondary}
              fontSize={18}
              textAnchor="end"
              fontFamily={theme.typography.body.fontFamily}
            >
              {Math.round((done / total) * 100)}%
            </text>
            <rect
              x={0}
              y={10}
              width={CARD_W}
              height={6}
              rx={3}
              fill={theme.colors.surface}
              opacity={0.6}
            />
            <rect
              x={0}
              y={10}
              width={CARD_W * (done / total)}
              height={6}
              rx={3}
              fill={theme.colors.success}
            />
          </g>
        ) : null}
      </svg>
    </AbsoluteFill>
  );
};
