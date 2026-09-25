import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { darkTechTheme } from "../theme.js";

export interface CharacterProps {
  /** Toggles mouth-open vs mouth-closed at speech rate (~12 Hz). When
   * the scene is silent (no narration in this slice) pass 0 here and
   * the mouth stays closed. */
  mouthOpen: number;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/**
 * Simple SVG-based animated presenter character. No external image
 * generation required — the figure is geometric (rounded rectangle
 * head, dot eyes, gradient body) and animates procedurally:
 *  - Body breathes (±2% scale at one cycle / 3 s).
 *  - Head gently sways (±2° rotation at one cycle / 4 s).
 *  - Eyes blink every ~3 s (visible blink at 0.6 alpha for 2 frames).
 *  - Mouth opens/closes driven by `mouthOpen` (0..1).
 *
 * The character is sized for a bottom-corner presence (typical
 * Chinese explainer layout — character "anchors" the lower-right while
 * the illustration occupies the rest of the frame).
 */
export const Character: FC<CharacterProps> = ({
  mouthOpen,
  frame,
  durationInFrames,
}) => {
  const seconds = frame / 30;
  const breath = 1 + Math.sin((seconds / 3) * Math.PI * 2) * 0.02;
  const sway = Math.sin((seconds / 4) * Math.PI * 2) * 2;
  const blinkPhase = seconds % 3;
  const blink = blinkPhase < 0.15 ? 0 : 1; // visible
  const m = Math.min(1, Math.max(0, mouthOpen));
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          right: 80,
          bottom: 60,
          width: 220,
          height: 280,
          transform: `translateY(${-4 * Math.sin((seconds / 2) * Math.PI)}px) rotate(${sway}deg) scale(${breath})`,
          transformOrigin: "bottom center",
        }}
      >
        <svg width={220} height={280} viewBox="0 0 220 280">
          <defs>
            <linearGradient id="char-body" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5eead4" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.85" />
            </linearGradient>
          </defs>
          {/* Body */}
          <path
            d="M 40 90 Q 110 60 180 90 L 180 260 Q 110 290 40 260 Z"
            fill="url(#char-body)"
            stroke={darkTechTheme.colors.accent}
            strokeWidth={2}
          />
          {/* Head */}
          <ellipse
            cx={110}
            cy={62}
            rx={36}
            ry={40}
            fill="#0f172a"
            stroke={darkTechTheme.colors.accent}
            strokeWidth={2}
          />
          {/* Eyes */}
          <circle cx={94} cy={60} r={4} fill="#5eead4" opacity={blink} />
          <circle cx={126} cy={60} r={4} fill="#5eead4" opacity={blink} />
          {/* Eyelid lines when blinking */}
          <line x1={86} y1={60} x2={102} y2={60} stroke={darkTechTheme.colors.accent} strokeWidth={1.5} opacity={1 - blink} />
          <line x1={118} y1={60} x2={134} y2={60} stroke={darkTechTheme.colors.accent} strokeWidth={1.5} opacity={1 - blink} />
          {/* Mouth — opens/closes with speech */}
          <ellipse
            cx={110}
            cy={82 + m * 6}
            rx={8 + m * 4}
            ry={2 + m * 6}
            fill="#0f172a"
            stroke={darkTechTheme.colors.accent}
            strokeWidth={1.5}
          />
          {/* Subtle floating accent dot */}
          <circle
            cx={110 + Math.sin(seconds * 0.8) * 4}
            cy={40 + Math.sin(seconds * 0.6) * 3}
            r={2.5}
            fill={darkTechTheme.colors.accent}
            opacity={0.8}
          />
        </svg>
      </div>
    </AbsoluteFill>
  );
};

/**
 * Returns a `mouthOpen` 0..1 value suitable for `Character.mouthOpen`.
 * Rough speech-like envelope: high when `frame` is within the
 * scene's narration range, low otherwise. Use a sawtooth or sine
 * burst so the mouth isn't static.
 */
export function speechEnvelope(
  frame: number,
  startFrame: number,
  endFrame: number,
  hz: number = 12,
): number {
  const localFrame = frame - startFrame;
  if (localFrame < 0 || localFrame > endFrame - startFrame) return 0;
  const phase = (localFrame * hz) / 30;
  const wave = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
  return wave;
}
