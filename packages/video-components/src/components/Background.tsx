import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { darkTechTheme } from "../theme.js";

export interface BackgroundProps {
  /** Frame counter (0..N). Used to drive the continuous drift loop. */
  frame: number;
}

/**
 * Subtle ambient background. The video was previously just a flat dark
 * color — this adds two continuous motions layered behind the scene
 * content:
 *
 *  - A slow radial-gradient rotation (~1 rotation per 18 s at 30 fps)
 *    that subtly shifts hue without distracting.
 *  - A handful of soft-edged circles drifting upward at different
 *    speeds and sizes, fading in/out as they cross the frame.
 *
 * Layered behind scene content; the scene's own component draws on
 * top via normal z-order, and the Background component's elements all
 * sit at low opacity (≤ 0.2) so they read as ambient, never foreground.
 */
export const Background: FC<BackgroundProps> = ({ frame }) => {
  const seconds = frame / 30;
  const rotation = (seconds * (Math.PI * 2)) / 18;
  const drift = (offset: number, period: number) =>
    (((frame + offset) % period) / period) * 2 - 1; // -1..1

  const circles = [
    { x: 0.18, y: 0.3, size: 380, period: 540, alpha: 0.14, hue: 165 },
    { x: 0.82, y: 0.65, size: 280, period: 420, alpha: 0.11, hue: 195 },
    { x: 0.5, y: 0.85, size: 500, period: 720, alpha: 0.08, hue: 210 },
    { x: 0.12, y: 0.78, size: 200, period: 360, alpha: 0.13, hue: 175 },
    { x: 0.9, y: 0.15, size: 320, period: 480, alpha: 0.1, hue: 200 },
  ];

  return (
    <AbsoluteFill style={{ overflow: "hidden", background: darkTechTheme.colors.background }}>
      <div
        style={{
          position: "absolute",
          inset: "-25%",
          background: `radial-gradient(ellipse at 30% 20%, hsla(${170 + drift(0, 1200) * 25}, 80%, 35%, 0.18), transparent 55%), radial-gradient(ellipse at 75% 80%, hsla(${210 + drift(0, 1800) * 20}, 70%, 30%, 0.14), transparent 60%)`,
          transform: `rotate(${rotation * (180 / Math.PI)}deg)`,
        }}
      />
      {circles.map((c, i) => {
        const phase = drift(i * 100, c.period);
        const yOffset = -phase * 220;
        const opacity = c.alpha * (1 - Math.abs(phase) * 0.5);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${c.x * 100}%`,
              top: `${c.y * 100}%`,
              width: c.size,
              height: c.size,
              marginLeft: -c.size / 2,
              marginTop: -c.size / 2,
              borderRadius: "50%",
              background: `radial-gradient(circle, hsla(${c.hue}, 90%, 60%, 0.45) 0%, transparent 70%)`,
              opacity,
              transform: `translateY(${yOffset}px)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
