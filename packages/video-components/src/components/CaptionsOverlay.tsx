import type { Theme } from "../theme.js";
import { darkTechTheme } from "../theme.js";

export interface CaptionsOverlayProps {
  lines: string[];
  width: number;
  height: number;
  theme?: Theme;
}

/**
 * Burn-in caption track (plan §16 MVP-1: "Captions 可用"). Renders the
 * scene's wrapped caption lines at the bottom safe area — the lines come
 * from the compiled plan (CJK-aware wrapText, compile.ts), so this
 * component never re-wraps or truncates. Purely presentational: no
 * animation primitives, deterministic at any fps.
 */
export const CaptionsOverlay = ({
  lines,
  width,
  height,
  theme = darkTechTheme,
}: CaptionsOverlayProps) => {
  if (lines.length === 0) return null;
  const fontSize = Math.round(height * 0.042);
  const bottom = Math.round(height * 0.055);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: Math.round(fontSize * 0.25),
        pointerEvents: "none",
      }}
    >
      {lines.map((line, i) => (
        <div
          key={`${i}-${line.slice(0, 8)}`}
          style={{
            maxWidth: Math.round(width * 0.86),
            padding: `${Math.round(fontSize * 0.16)}px ${Math.round(fontSize * 0.5)}px`,
            backgroundColor: "rgba(11, 18, 32, 0.72)",
            color: theme.colors.primary,
            fontFamily: theme.typography.body.fontFamily,
            fontWeight: theme.typography.body.fontWeight,
            fontSize,
            lineHeight: 1.35,
            textAlign: "center",
            borderRadius: Math.round(fontSize * 0.3),
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
};
