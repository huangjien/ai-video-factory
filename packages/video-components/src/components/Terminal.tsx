import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { darkTechTheme, type Theme } from "../theme.js";
import { progressFor, type TimelineAnim } from "./timelineTiming.js";

export interface TerminalProps {
  theme?: Theme;
  /** Each line of the terminal body. Lines containing the substring
   *  `prompt + " " + command` are auto-detected as a user-typed line
   *  (slightly different styling). Pass `[command, output1, output2, ...]`
   *  for a typical prompt → command → output flow. */
  lines: string[];
  prompt?: string;
  title?: string;
  /** v0.4.1 — scene-level timeline animations. Each line
   *  `target: "line-${i}"` reveals at its own start time, replacing the
   *  global typewriter when present. */
  animations?: TimelineAnim[];
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** macOS-style window chrome — used by the rendered terminal. The 3
 *  traffic-light dots read as part of the brand language; in the
 *  remotion render they're SVG circles, not macOS chrome (so no
 *  Apple trademark concerns). */
const TITLE_BAR_H = 36;
const SHELL_W = 1400;
const SHELL_H = 760;

const STOP_TINT = "#ff5f57"; // close
const MIN_TINT = "#febc2e";   // minimize
const MAX_TINT = "#28c840";   // maximize (zoom)

/** The default prompt that a line is compared against to decide if it
 *  represents a user-typed command line. */
function lineIsCommand(line: string, prompt: string): boolean {
  if (line.length === 0) return false;
  return line.startsWith(prompt + " ") || line === prompt;
}

export const Terminal: FC<TerminalProps> = ({
  theme = darkTechTheme,
  lines,
  prompt = "$",
  title = "bash — 80×24",
  animations,
  frame,
  durationInFrames,
}) => {
  const hasAnimations = Array.isArray(animations) && animations.length > 0;
  const sceneSec =
    durationInFrames > 0
      ? frame * (durationInFrames / 30 / durationInFrames)
      : frame / 30;

  // Per-line reveal. When timeline animations are present, each line
  //  "type-in" is driven by its own line-${i} cue (characters of the
  //  line are progressively shown). Otherwise we fall back to a single
  //  global typewriter across the whole block.
  const perLine = lines.map((line, i) => {
    if (!hasAnimations) {
      return { line, shown: line.length, isCommand: lineIsCommand(line, prompt) };
    }
    const p = progressFor(animations, `line-${i}`, sceneSec, 0.5);
    return {
      line,
      shown: Math.max(0, Math.ceil(line.length * p)),
      isCommand: lineIsCommand(line, prompt),
    };
  });

  // Cursor blink: 1 Hz square wave, on for half a second.
  const cursorOn = Math.floor(sceneSec * 2) % 2 === 0;

  // Theme tokens. We treat the terminal body as if it has its own dark
  // surface independent of the page background so it always reads as a
  // terminal — the body, prompt, and caret use derived dark colors.
  const bodyBg = "#1B1B1B";
  const bodyFg = "#E6E6E6";
  const promptColor = "#7BD88F";
  const commandColor = "#FFFFFF";
  const outputColor = "#B0B0B0";
  const errorColor = "#FF8A80";
  const titleBarBg = "#2A2A2A";
  const titleBarFg = "#9A9A9A";
  const caretColor = "#E6E6E6";
  const shadow = "0 24px 56px rgba(0,0,0,0.32), 0 4px 12px rgba(0,0,0,0.18)";

  return (
    <AbsoluteFill
      style={{
        // No solid background — let the page background show through so
        // the terminal "floats" on the theme.
        backgroundColor: "transparent",
        justifyContent: "center",
        alignItems: "center",
        opacity: hasAnimations ? 1 : 1,
      }}
    >
      <div
        style={{
          width: SHELL_W,
          height: SHELL_H,
          borderRadius: 14,
          backgroundColor: bodyBg,
          boxShadow: shadow,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: theme.typography.code.fontFamily,
        }}
      >
        {/* Title bar — macOS-style traffic lights + centered title.
            Pointer-events disabled so the chrome never intercepts. */}
        <div
          style={{
            height: TITLE_BAR_H,
            backgroundColor: titleBarBg,
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            position: "relative",
            flexShrink: 0,
            pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: STOP_TINT,
              }}
            />
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: MIN_TINT,
              }}
            />
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: MAX_TINT,
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              textAlign: "center",
              color: titleBarFg,
              fontSize: 13,
              fontFamily: theme.typography.code.fontFamily,
              lineHeight: `${TITLE_BAR_H}px`,
            }}
          >
            {title}
          </div>
        </div>

        {/* Body — monospace lines, prompt prefix on the user's commands,
            and a blinking caret on the last line. Lines wrap-fade in by
            character; commands get a soft-tinted background row. */}
        <div
          style={{
            flex: 1,
            padding: "20px 24px",
            overflow: "hidden",
            color: bodyFg,
            fontSize: 24,
            lineHeight: 1.45,
            fontFamily: theme.typography.code.fontFamily,
          }}
        >
          {perLine.map((p, i) => {
            const shownText = p.line.slice(0, p.shown);
            const isCmd = p.isCommand;
            const lineColor = isCmd ? commandColor : outputColor;
            // For a command line, split off the prompt so it gets its own
            // tint; the rest of the line uses the command color.
            const rest =
              isCmd && shownText.startsWith(prompt)
                ? shownText.slice(prompt.length)
                : shownText;
            return (
              <div
                key={`line-${i}`}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  padding: "2px 8px",
                  marginLeft: -8,
                  borderRadius: 4,
                  backgroundColor: isCmd
                    ? "rgba(123, 216, 143, 0.06)"
                    : "transparent",
                  whiteSpace: "pre",
                }}
              >
                {isCmd ? (
                  <span
                    style={{
                      color: promptColor,
                      marginRight: 8,
                      fontWeight: 500,
                    }}
                  >
                    {prompt}
                  </span>
                ) : null}
                <span style={{ color: lineColor }}>{rest || " "}</span>
                {/* Blinking caret — only on the last line, only while
                    its reveal is still in progress or just finished. */}
                {i === perLine.length - 1 && p.shown >= p.line.length && cursorOn ? (
                  <span
                    style={{
                      display: "inline-block",
                      width: 11,
                      height: 22,
                      backgroundColor: caretColor,
                      marginLeft: 2,
                      verticalAlign: "text-bottom",
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
