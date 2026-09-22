import { z } from "zod";

/**
 * VDSL 0.1 schema — executable render input (doc §21.1, lines 889-932).
 * All durations are SECONDS; the compiler converts to frames (line 887).
 * Unknown fields are rejected everywhere (line 931): agents must never
 * silently emit unsupported config.
 *
 * LLM agents frequently emit synonyms for the canonical enum values
 * (e.g. "slide-up", "bounce", "fade-in" for entrance; "fade-out" for
 * exit; "script" / "voice" / "auto" for captions.source). The coerce
 * functions below map the common vocabulary down to the canonical enum
 * before zod validates. Truly unparseable values still fail the schema
 * (so a real bug isn't masked as a synonym).
 */

const ANIMATION_ENTRANCE_CANONICAL = [
  "none",
  "fade",
  "slide",
  "scale",
  "draw",
  "typewriter",
] as const;

const ANIMATION_ENTRANCE_SYNONYMS: Record<string, (typeof ANIMATION_ENTRANCE_CANONICAL)[number]> = {
  none: "none",
  // "fade" cluster
  fade: "fade",
  "fade-in": "fade",
  fade_in: "fade",
  // "slide" cluster
  slide: "slide",
  "slide-up": "slide",
  "slide-up-down": "slide",
  "slide-in": "slide",
  "slideup": "slide",
  "sliding": "slide",
  "swipe": "slide",
  "slide-down": "slide",
  // "scale" cluster — covers zoom / bounce / pop / grow / pulse etc.
  scale: "scale",
  bounce: "scale",
  pop: "scale",
  zoom: "scale",
  "zoom-in": "scale",
    zoomin: "scale",
  grow: "scale",
  pulse: "scale",
  "scale-up": "scale",
  scale_up: "scale",
  // "draw" cluster
  draw: "draw",
  "wipe": "draw",
  "reveal": "draw",
  // "typewriter" cluster
  typewriter: "typewriter",
  "type-writer": "typewriter",
  type_writer: "typewriter",
  "type write": "typewriter",
  "type-write": "typewriter",
  "type-write-step-by-step": "typewriter",
};

export function coerceAnimationEntrance(raw: string): (typeof ANIMATION_ENTRANCE_CANONICAL)[number] {
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, "-");
  const mapped = ANIMATION_ENTRANCE_SYNONYMS[key];
  if (mapped) return mapped;
  // Allow the canonical values as-is (already normalized to lowercase).
  if ((ANIMATION_ENTRANCE_CANONICAL as readonly string[]).includes(key)) {
    return key as (typeof ANIMATION_ENTRANCE_CANONICAL)[number];
  }
  throw new Error(
    `unknown animation.entrance: "${raw}" (canonical: ${ANIMATION_ENTRANCE_CANONICAL.join(", ")})`,
  );
}

const ANIMATION_EXIT_CANONICAL = ["none", "fade"] as const;
const ANIMATION_EXIT_SYNONYMS: Record<string, (typeof ANIMATION_EXIT_CANONICAL)[number]> = {
  none: "none",
  "fade-out": "fade",
  fade_out: "fade",
  fadeout: "fade",
  "fade to black": "fade",
  "fade to white": "fade",
  crossfade: "fade",
};

export function coerceAnimationExit(raw: string): (typeof ANIMATION_EXIT_CANONICAL)[number] {
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, "-");
  const mapped = ANIMATION_EXIT_SYNONYMS[key];
  if (mapped) return mapped;
  if ((ANIMATION_EXIT_CANONICAL as readonly string[]).includes(key)) {
    return key as (typeof ANIMATION_EXIT_CANONICAL)[number];
  }
  throw new Error(
    `unknown animation.exit: "${raw}" (canonical: ${ANIMATION_EXIT_CANONICAL.join(", ")})`,
  );
}

const ANIMATION_EMPHASIS_CANONICAL = ["none", "highlight", "counter"] as const;
const ANIMATION_EMPHASIS_SYNONYMS: Record<string, (typeof ANIMATION_EMPHASIS_CANONICAL)[number]> = {  none: "none",
  highlight: "highlight",
  emphasised: "highlight",
  emphasized: "highlight",
  emphasize: "highlight",
  highlight_text: "highlight",
  "highlight-text": "highlight",
  counter: "counter",
  count: "counter",
  number: "counter",
    "increment": "counter",
  "animated-counter": "counter",
  "animated number": "counter",};

export function coerceAnimationEmphasis(
  raw: string,
): (typeof ANIMATION_EMPHASIS_CANONICAL)[number] {
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, "-");
  const mapped = ANIMATION_EMPHASIS_SYNONYMS[key];
  if (mapped) return mapped;
  if ((ANIMATION_EMPHASIS_CANONICAL as readonly string[]).includes(key)) {
    return key as (typeof ANIMATION_EMPHASIS_CANONICAL)[number];
  }
  throw new Error(
    `unknown animation.emphasis: "${raw}" (canonical: ${ANIMATION_EMPHASIS_CANONICAL.join(", ")})`,
  );
}

const CAPTIONS_SOURCE_CANONICAL = ["narration", "none"] as const;
const CAPTIONS_SOURCE_SYNONYMS: Record<string, (typeof CAPTIONS_SOURCE_CANONICAL)[number]> = {
  none: "none",
  narration: "narration",
  script: "narration",
  voice: "narration",
  speech: "narration",
  audio: "narration",
  spoken: "narration",
  auto: "narration",
  generated: "narration",
  "narration-subtitle": "narration",
  subtitle: "narration",
  caption: "narration",
  captions: "narration",
  subtitles: "none",
  off: "none",
  no_captions: "none",
  "no-captions": "none",
  none_captions: "none",
};

export function coerceCaptionsSource(
  raw: string,
): (typeof CAPTIONS_SOURCE_CANONICAL)[number] {
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, "-");
  const mapped = CAPTIONS_SOURCE_SYNONYMS[key];
  if (mapped) return mapped;
  if ((CAPTIONS_SOURCE_CANONICAL as readonly string[]).includes(key)) {
    return key as (typeof CAPTIONS_SOURCE_CANONICAL)[number];
  }
  throw new Error(
    `unknown captions.source: "${raw}" (canonical: ${CAPTIONS_SOURCE_CANONICAL.join(", ")})`,
  );
}

const TRANSITION_CANONICAL = ["fade", "cut"] as const;
export const TRANSITIONS = TRANSITION_CANONICAL;
const TRANSITION_SYNONYMS: Record<string, (typeof TRANSITION_CANONICAL)[number]> = {
  none: "cut",
  cut: "cut",
  jump: "cut",
  hard: "cut",
  hardcut: "cut",
  "hard-cut": "cut",
  instantaneous: "cut",
  direct: "cut",
  fade: "fade",
  crossfade: "fade",
  cross: "fade",
  dissolve: "fade",
  "cross-fade": "fade",
};

export function coerceTransition(raw: string): (typeof TRANSITION_CANONICAL)[number] {
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, "-");
  const mapped = TRANSITION_SYNONYMS[key];
  if (mapped) return mapped;
  if ((TRANSITION_CANONICAL as readonly string[]).includes(key)) {
    return key as (typeof TRANSITION_CANONICAL)[number];
  }
  throw new Error(
    `unknown transition: "${raw}" (canonical: ${TRANSITION_CANONICAL.join(", ")})`,
  );
}

/** Preprocess wrapper that catches the throw and returns the raw value
 * so zod's enum reports the failure cleanly via safeParse (success=false)
 * instead of propagating an exception. Unknown values still fail — the
 * schema must catch a real bug, not mask it as a synonym. */
function safeCoerce<T extends readonly string[]>(
  coerce: (raw: string) => T[number],
  _canonical: T,
): (arg: unknown) => unknown {
  return (arg: unknown): unknown => {
    if (typeof arg !== "string") return arg;
    try {
      return coerce(arg);
    } catch {
      return arg;
    }
  };
}

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
    entrance: z.preprocess(
      safeCoerce(coerceAnimationEntrance, ANIMATION_ENTRANCE_CANONICAL),
      z.enum(ANIMATION_ENTRANCE_CANONICAL),
    ).default("none"),
    emphasis: z.preprocess(
      safeCoerce(coerceAnimationEmphasis, ANIMATION_EMPHASIS_CANONICAL),
      z.enum(ANIMATION_EMPHASIS_CANONICAL),
    ).default("none"),
    exit: z.preprocess(
      safeCoerce(coerceAnimationExit, ANIMATION_EXIT_CANONICAL),
      z.enum(ANIMATION_EXIT_CANONICAL),
    ).default("none"),
  })
  .strict();

const captionsSchema = z
  .object({
    source: z.preprocess(
      safeCoerce(coerceCaptionsSource, CAPTIONS_SOURCE_CANONICAL),
      z.enum(CAPTIONS_SOURCE_CANONICAL),
    ),
    text: z.string().optional(),
  })
  .strict();

const transitionSchema = z
  .object({
    in: z.preprocess(safeCoerce(coerceTransition, TRANSITION_CANONICAL), z.enum(TRANSITION_CANONICAL)),
    out: z.preprocess(safeCoerce(coerceTransition, TRANSITION_CANONICAL), z.enum(TRANSITION_CANONICAL)),
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

export const ANIMATION_ENTRANCES = ANIMATION_ENTRANCE_CANONICAL;
