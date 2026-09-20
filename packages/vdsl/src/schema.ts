import { z } from "zod";

/**
 * VDSL 0.1 schema — executable render input (doc §21.1, lines 889-932).
 * All durations are SECONDS; the compiler converts to frames (line 887).
 * Unknown fields are rejected everywhere (line 931): agents must never
 * silently emit unsupported config.
 */

export const ANIMATION_ENTRANCES = [
  "none",
  "fade",
  "slide",
  "scale",
  "draw",
  "typewriter",
] as const;

export const TRANSITIONS = ["fade", "cut"] as const;

const projectSchema = z
  .object({
    id: z.string().min(1),
    language: z.enum(["zh-CN", "en-US"]),
    fps: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

const styleSchema = z
  .object({
    theme: z.string().min(1).default("dark-tech"),
  })
  .strict();

const narrationSchema = z
  .object({
    text: z.string().min(1),
    audio: z.string().min(1).optional(),
  })
  .strict();

const visualSchema = z
  .object({
    component: z.string().min(1),
    props: z.record(z.unknown()),
  })
  .strict();

const animationSchema = z
  .object({
    entrance: z.enum(ANIMATION_ENTRANCES).default("none"),
    emphasis: z.enum(["none", "highlight", "counter"]).default("none"),
    exit: z.enum(["none", "fade"]).default("none"),
  })
  .strict();

const captionsSchema = z
  .object({
    source: z.enum(["narration", "none"]),
    text: z.string().optional(),
  })
  .strict();

const transitionSchema = z
  .object({
    in: z.enum(TRANSITIONS),
    out: z.enum(TRANSITIONS),
  })
  .strict();

const sceneSchema = z
  .object({
    id: z.string().min(1),
    duration: z.number().positive(),
    narration: narrationSchema.optional(),
    visual: visualSchema,
    animation: animationSchema.optional(),
    captions: captionsSchema.optional(),
    transition: transitionSchema.optional(),
  })
  .strict();

export const storyboardSchema = z
  .object({
    schema_version: z.literal("0.1"),
    project: projectSchema,
    style: styleSchema.optional(),
    scenes: z.array(sceneSchema).min(1),
  })
  .strict();

export type Storyboard = z.infer<typeof storyboardSchema>;
export type Scene = z.infer<typeof sceneSchema>;
