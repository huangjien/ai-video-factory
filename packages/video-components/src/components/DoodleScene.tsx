import { z } from "zod";
import { darkTechTheme } from "../theme.js";
import {
  buildStrokePlan,
  drawDoodleFrame,
  hashStr,
  type CtxLike,
  type DoodleShape,
  type DoodleStrokeSpec,
  type DoodleStyle,
} from "./doodleLogic.js";

/**
 * DoodleScene — canvas hand-drawn scenes (plan T4.4, §3.4/§18). Strokes
 * draw on sequentially frame-by-frame on a <canvas>; the frame draw is a
 * pure function of the frame number (seeded wobble, no Math.random/Date —
 * javascript-animation skill contract). Deterministic per §62.4.
 */

export const DoodleScenePropsSchema = z
  .object({
    strokes: z
      .array(
        z
          .object({
            id: z.string().min(1),
            points: z.array(z.tuple([z.number(), z.number()])).optional(),
            shape: z.enum(["circle", "star", "zigzag", "spiral"]).optional(),
            x: z.number().optional(),
            y: z.number().optional(),
            size: z.number().optional(),
            color: z.string().optional(),
            width: z.number().optional(),
            passes: z.number().optional(),
          })
          .passthrough(),
      )
      .min(1),
    background: z.enum(["paper", "dark"]).default("paper"),
    /** Hand-drawn wobble in px (seeded — deterministic). */
    wobble: z.number().default(2.5),
    seed: z.number().default(1),
  })
  .passthrough();

export type DoodleSceneProps = {
  frame: number;
  durationInFrames: number;
} & z.infer<typeof DoodleScenePropsSchema>;

const CANVAS_W = 1920;
const CANVAS_H = 1080;

const PAPER: DoodleStyle = { background: "#F5F1E8", ink: "#1F1D1A", wobble: 2.5 };
const DARK: DoodleStyle = {
  background: darkTechTheme.colors.background,
  ink: darkTechTheme.colors.primary,
  wobble: 2.5,
};

export const DoodleScene = (props: DoodleSceneProps) => {
  const { frame, durationInFrames, strokes, background, wobble, seed } = props;
  const fps = (props as { fps?: number }).fps ?? 30;
  const style: DoodleStyle = {
    ...(background === "paper" ? PAPER : DARK),
    wobble,
  };
  const specs: DoodleStrokeSpec[] = strokes.map((s) => ({
    ...s,
    ...(s.shape !== undefined ? { shape: s.shape as DoodleShape } : {}),
  }));
  const plan = buildStrokePlan(specs, durationInFrames / fps, seed, style);

  return (
    <canvas
      width={CANVAS_W}
      height={CANVAS_H}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      ref={(el) => {
        if (!el) return;
        const ctx = el.getContext("2d");
        if (!ctx) return;
        drawDoodleFrame(
          ctx as unknown as CtxLike,
          plan,
          frame,
          fps,
          style,
          CANVAS_W,
          CANVAS_H,
        );
      }}
    />
  );
};

export function doodleSeedFor(id: string): number {
  return hashStr(id);
}
