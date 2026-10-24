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

const ANIMATION_ENTRANCE_SYNONYMS: Record<
  string,
  (typeof ANIMATION_ENTRANCE_CANONICAL)[number]
> = {
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
  // Directional slides. Observed from GLM on 2026-10-18 via
  // `video prompts eval --judge` (docs/v0.10-prompt-evals-plan.md §8 gap 2):
  // the model reached for a direction every time, and the schema threw away
  // the whole storyboard. Direction is not expressible downstream —
  // compile.ts carries this as a plain enum and animation-emitter treats
  // every "slide" the same — so collapsing the qualifier is lossless.
  "slide-left": "slide",
  "slide-right": "slide",
  "slide-out": "slide",
  "slide-in-from-left": "slide",
  "slide-in-from-right": "slide",
  "slide-in-from-bottom": "slide",
  "slide-in-both-sides": "slide",
  slideup: "slide",
  sliding: "slide",
  swipe: "slide",
  "slide-down": "slide",
  // Vertical translate verbs: an element moving up into place is a "slide"
  // downstream — compile.ts carries one "slide" and animation-emitter does
  // not branch on direction. Observed as "rise" alongside the `style` key
  // problem on 2026-10-18.
  rise: "slide",
  "rise-up": "slide",
  lift: "slide",
  "lift-up": "slide",
  elevate: "slide",
  ascend: "slide",
  // "scale" cluster — covers zoom / bounce / pop / grow / pulse etc.
  scale: "scale",
  bounce: "scale",
  pop: "scale",
  zoom: "scale",
  "zoom-in": "scale",
  zoomin: "scale",
  // Same incident: "zoom-out" arrived alongside the directional slides.
  "zoom-out": "scale",
  "zoom-in-out": "scale",
  grow: "scale",
  pulse: "scale",
  "scale-up": "scale",
  scale_up: "scale",
  "scale-down": "scale",
  // "draw" cluster
  draw: "draw",
  wipe: "draw",
  reveal: "draw",
  // "typewriter" cluster
  typewriter: "typewriter",
  "type-writer": "typewriter",
  type_writer: "typewriter",
  "type write": "typewriter",
  "type-write": "typewriter",
  "type-write-step-by-step": "typewriter",
};

/** Qualifiers that only pick a direction or a starting edge. A value whose
 *  every segment after the cluster head is one of these is a synonym for the
 *  head — `slide-in-both-sides` is "slide", not a typo. Anything else is
 *  still rejected, which is what keeps a real bug visible. */
const DIRECTIONAL_QUALIFIERS = new Set([
  "left",
  "right",
  "leftward",
  "rightward",
  "up",
  "down",
  "upward",
  "downward",
  "in",
  "out",
  "on",
  "off",
  "over",
  "under",
  "across",
  "through",
  "away",
  "back",
  "around",
  "forward",
  "backward",
  "from",
  "to",
  "toward",
  "towards",
  "top",
  "bottom",
  "both",
  "side",
  "sides",
  "horizontal",
  "vertical",
  "diagonal",
  "edge",
  "corner",
  "center",
  "centre",
  "inside",
  "outside",
  "screen",
  "offscreen",
  "onscreen",
]);

/** Cluster head → canonical value. Only heads that meaningfully take a
 *  directional qualifier appear here; `typewriter` deliberately does not, so
 *  a mangled typewriter animation still fails instead of quietly becoming a
 *  fade. */
const DIRECTIONAL_CLUSTER_HEADS: Record<
  string,
  (typeof ANIMATION_ENTRANCE_CANONICAL)[number]
> = {
  slide: "slide",
  swipe: "slide",
  zoom: "scale",
  scale: "scale",
  fade: "fade",
  crossfade: "fade",
  wipe: "draw",
};

/**
 * `slide-in-from-left` → "slide", `fade-from-top` → "fade".
 *
 * The table above covers what was actually observed; this covers the open
 * space around it, because enumerating every direction a model might reach
 * for is how the original list ended up incomplete. Scoped to directional
 * qualifiers on purpose: `slide-banana` still fails, so the "reject real bugs"
 * guarantee in this module's header survives.
 */
function stripDirectionalQualifiers(
  key: string,
): (typeof ANIMATION_ENTRANCE_CANONICAL)[number] | null {
  const segments = key.split("-");
  if (segments.length < 2) return null;
  const head = segments[0];
  if (!head) return null;
  const canonical = DIRECTIONAL_CLUSTER_HEADS[head];
  if (!canonical) return null;
  return segments.slice(1).every((q) => DIRECTIONAL_QUALIFIERS.has(q))
    ? canonical
    : null;
}

export function coerceAnimationEntrance(
  raw: string,
): (typeof ANIMATION_ENTRANCE_CANONICAL)[number] {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
  const mapped = ANIMATION_ENTRANCE_SYNONYMS[key];
  if (mapped) return mapped;
  // Allow the canonical values as-is (already normalized to lowercase).
  if ((ANIMATION_ENTRANCE_CANONICAL as readonly string[]).includes(key)) {
    return key as (typeof ANIMATION_ENTRANCE_CANONICAL)[number];
  }
  const directional = stripDirectionalQualifiers(key);
  if (directional) return directional;
  throw new Error(
    `unknown animation.entrance: "${raw}" (canonical: ${ANIMATION_ENTRANCE_CANONICAL.join(", ")})`,
  );
}

const ANIMATION_EXIT_CANONICAL = ["none", "fade"] as const;
const ANIMATION_EXIT_SYNONYMS: Record<
  string,
  (typeof ANIMATION_EXIT_CANONICAL)[number]
> = {
  none: "none",
  "fade-out": "fade",
  fade_out: "fade",
  fadeout: "fade",
  "fade to black": "fade",
  "fade to white": "fade",
  crossfade: "fade",
};

export function coerceAnimationExit(
  raw: string,
): (typeof ANIMATION_EXIT_CANONICAL)[number] {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
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
const ANIMATION_EMPHASIS_SYNONYMS: Record<
  string,
  (typeof ANIMATION_EMPHASIS_CANONICAL)[number]
> = {
  none: "none",
  highlight: "highlight",
  emphasised: "highlight",
  emphasized: "highlight",
  emphasize: "highlight",
  highlight_text: "highlight",
  "highlight-text": "highlight",
  counter: "counter",
  count: "counter",
  number: "counter",
  increment: "counter",
  "animated-counter": "counter",
  "animated number": "counter",
};

export function coerceAnimationEmphasis(
  raw: string,
): (typeof ANIMATION_EMPHASIS_CANONICAL)[number] {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
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
const CAPTIONS_SOURCE_SYNONYMS: Record<
  string,
  (typeof CAPTIONS_SOURCE_CANONICAL)[number]
> = {
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
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
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
const TRANSITION_SYNONYMS: Record<
  string,
  (typeof TRANSITION_CANONICAL)[number]
> = {
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

export function coerceTransition(
  raw: string,
): (typeof TRANSITION_CANONICAL)[number] {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
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

// ---------------------------------------------------------------------------
// VDSL 0.2 additions — visual renderer abstraction (plan §9), timeline
// animation model (plan §10), and project-level assets (plan §11). All new
// fields are OPTIONAL so every 0.1 storyboard validates unchanged.
// ---------------------------------------------------------------------------

const VISUAL_RENDERER_CANONICAL = ["remotion", "canvas"] as const;
const VISUAL_RENDERER_SYNONYMS: Record<
  string,
  (typeof VISUAL_RENDERER_CANONICAL)[number]
> = {
  remotion: "remotion",
  react: "remotion",
  component: "remotion",
  canvas: "canvas",
  handdrawn: "canvas",
  "hand-drawn": "canvas",
  doodle: "canvas",
};

export function coerceVisualRenderer(
  raw: string,
): (typeof VISUAL_RENDERER_CANONICAL)[number] {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
  const mapped = VISUAL_RENDERER_SYNONYMS[key];
  if (mapped) return mapped;
  if ((VISUAL_RENDERER_CANONICAL as readonly string[]).includes(key)) {
    return key as (typeof VISUAL_RENDERER_CANONICAL)[number];
  }
  throw new Error(
    `unknown visual.renderer: "${raw}" (canonical: ${VISUAL_RENDERER_CANONICAL.join(", ")})`,
  );
}

/** Timeline animation types — first batch per plan §10. spring/path-follow/
 * particle/mask/blur/glow/parallax are deliberately NOT accepted yet. */
const ANIMATION_TYPE_CANONICAL = [
  "draw",
  "write",
  "fade",
  "move",
  "scale",
  "rotate",
  "highlight",
  "morph",
] as const;
const ANIMATION_TYPE_SYNONYMS: Record<
  string,
  (typeof ANIMATION_TYPE_CANONICAL)[number]
> = {
  draw: "draw",
  wipe: "draw",
  stroke: "draw",
  write: "write",
  type: "write",
  handwriting: "write",
  fade: "fade",
  "fade-in": "fade",
  fadein: "fade",
  appear: "fade",
  move: "move",
  "move-to": "move",
  translate: "move",
  slide: "move",
  scale: "scale",
  zoom: "scale",
  pop: "scale",
  rotate: "rotate",
  spin: "rotate",
  highlight: "highlight",
  emphasize: "highlight",
  marker: "highlight",
  morph: "morph",
  morphing: "morph",
};

export function coerceAnimationType(
  raw: string,
): (typeof ANIMATION_TYPE_CANONICAL)[number] {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
  const mapped = ANIMATION_TYPE_SYNONYMS[key];
  if (mapped) return mapped;
  if ((ANIMATION_TYPE_CANONICAL as readonly string[]).includes(key)) {
    return key as (typeof ANIMATION_TYPE_CANONICAL)[number];
  }
  throw new Error(
    `unknown animations[].type: "${raw}" (canonical: ${ANIMATION_TYPE_CANONICAL.join(", ")})`,
  );
}

const EASING_CANONICAL = ["linear", "easeIn", "easeOut", "easeInOut"] as const;
const EASING_SYNONYMS: Record<string, (typeof EASING_CANONICAL)[number]> = {
  linear: "linear",
  none: "linear",
  easein: "easeIn",
  "ease-in": "easeIn",
  easeout: "easeOut",
  "ease-out": "easeOut",
  easeinout: "easeInOut",
  "ease-in-out": "easeInOut",
  smooth: "easeInOut",
};

export function coerceEasing(raw: string): (typeof EASING_CANONICAL)[number] {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
  const mapped = EASING_SYNONYMS[key];
  if (mapped) return mapped;
  if ((EASING_CANONICAL as readonly string[]).includes(key)) {
    return key as (typeof EASING_CANONICAL)[number];
  }
  throw new Error(
    `unknown easing: "${raw}" (canonical: ${EASING_CANONICAL.join(", ")})`,
  );
}

const ASSET_TYPE_CANONICAL = [
  "svg",
  "png",
  "jpg",
  "webp",
  "canvas",
  "audio",
  "video",
  "font",
] as const;

const assetSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(ASSET_TYPE_CANONICAL),
    source: z.enum(["generated", "user", "external"]).default("generated"),
    path: z.string().min(1),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const timelineAnimationSchema = z
  .object({
    id: z.string().min(1),
    target: z.string().min(1),
    type: z.preprocess(
      safeCoerce(coerceAnimationType, ANIMATION_TYPE_CANONICAL),
      z.enum(ANIMATION_TYPE_CANONICAL),
    ),
    /** Seconds relative to scene start. */
    start: z.number().min(0),
    duration: z.number().positive(),
    easing: z
      .preprocess(
        safeCoerce(coerceEasing, EASING_CANONICAL),
        z.enum(EASING_CANONICAL),
      )
      .default("easeInOut"),
  })
  .strict();

const projectSchema = z
  .object({
    id: z.string().min(1),
    language: z.enum(["zh-CN", "en-US"]),
    fps: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

/**
 * Branding / marketing identity (feature 2026-10-05). Authored either in
 * storyboard `style.brand` directly or in a project-level `brand.yaml`
 * that the render command merges over the compiled plan.
 *
 * - `icon` (project-relative path, served via staticFile) is drawn at a
 *   fixed corner of EVERY scene for the whole duration — the channel
 *   watermark.
 * - `intro` fixes the opening look: for the first `duration_sec` the
 *   renderer adds a brand gradient chrome (top band with `name` + a
 *   subtle full-screen tint) so the opening reads as one branded block.
 */
export const brandSchema = z
  .object({
    /** Channel / product name shown in the intro band. */
    name: z.string().min(1).optional(),
    /**
     * CS-08: the per-scene corner watermark. Defaults to on, because every
     * project inherits the workspace brand. A project whose channel does
     * not want a mark on every narrative shot sets this to false — an
     * explicit switch, rather than the absence of an icon, which would be
     * indistinguishable from "not configured yet".
     */
    watermark: z.boolean().default(true),
    /** Project-relative image path (png/jpg/svg) — corner watermark. */
    icon: z.string().min(1).optional(),
    corner: z
      .enum(["top-left", "top-right", "bottom-left", "bottom-right"])
      .default("bottom-right"),
    /** Watermark edge length in px at 1080p (scaled by width/1920). */
    size_px: z.number().int().min(16).max(512).default(72),
    /** Watermark opacity 0-1. */
    opacity: z.number().min(0.05).max(1).default(0.85),
    intro: z
      .object({
        /** Branded-chrome window from t=0; 10-20s is the marketing norm. */
        duration_sec: z.number().min(1).max(120).default(15),
        /** Named gradient: aurora | sunset | ocean | citrus. */
        background: z
          .enum(["aurora", "sunset", "ocean", "citrus"])
          .default("aurora"),
        /** Show `name` in the intro band (requires name when true). */
        show_name: z.boolean().default(true),
      })
      .strict()
      .optional(),
  })
  .strict();

export type BrandConfig = z.infer<typeof brandSchema>;

const styleSchema = z
  .object({
    theme: z.string().min(1).default("paper-light"),
    /** CS-01: optional channel grammar profile, carried through to
     *  RenderPlan.style. Omitted for every pre-CS-01 project, which is
     *  what keeps their behaviour unchanged. */
    channel_profile: z.string().min(1).optional(),
    brand: brandSchema.optional(),
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
    /**
     * `visual` — WHAT the audience sees for the whole scene. Two choices
     * pair up: `component` picks the registered implementation (validated
     * against REGISTRY, doc §21.1 line 928) and `renderer` picks the
     * scene family that draws it (plan §9). Current pairings:
     *
     * | renderer   | component      | look |
     * |------------|----------------|------|
     * | remotion   | Title, Paragraph, CodeBlock, Terminal, FlowChart, Timeline, Callout, EndCard, Character, Image, ImageBackground, AnimatedIllustration | classic motion graphics on the theme background |
     * | canvas     | DoodleScene    | hand-drawn ink: procedural strokes (circle/star/zigzag/spiral) with seeded wobble, sequential pen-draw, optional BPM beat-sync |
     *
     * `props` are validated against the component's own registry schema,
     * so each component documents its own shape (Title wants `text` +
     * optional `subtext`). Synonyms are coerced for `renderer`
     * (e.g. "hand-drawn"/"doodle" → canvas); unknown renderers fail
     * loudly at render time rather than silently substituting a
     * different look.
     */
    component: z.string().min(1),
    props: z.record(z.unknown()),
    /** Which scene family draws this scene (plan §9). Optional at parse
     * time: an omitted renderer inherits from the project-level
     * `defaults:` block, falling back to "remotion" (REGISTRY components)
     * — see applyRendererDefaults below. The compiled vdsl.yaml and
     * RenderPlan always carry an explicit per-scene renderer; unwired
     * combinations (e.g. canvas + FlowChart) fail loudly at render time
     * (assertPlanRenderable lists the wired pairings). */
    renderer: z
      .preprocess(
        safeCoerce(coerceVisualRenderer, VISUAL_RENDERER_CANONICAL),
        z.enum(VISUAL_RENDERER_CANONICAL),
      )
      .optional(),
    /**
     * `background` — control over the scene background IMAGE, which every
     * component gets for free: when `assets/images/scene_N.jpg` exists the
     * renderer binds it behind the component (resolveImageSources), so a
     * FlowChart or a Title draws on the generated scene art instead of a
     * flat theme fill. Nothing in the storyboard is required to opt in —
     * the image is already on disk from `video make`.
     *
     * `scrim` (default true) overlays a dark gradient so text overlaid on
     * the photo stays legible. Set false for a clean full-bleed image.
     */
    background: z
      .object({
        scrim: z.boolean().default(true),
      })
      .strict()
      .optional(),
  })
  .strict();

const animationSchema = z
  .object({
    entrance: z
      .preprocess(
        safeCoerce(coerceAnimationEntrance, ANIMATION_ENTRANCE_CANONICAL),
        z.enum(ANIMATION_ENTRANCE_CANONICAL),
      )
      .default("none"),
    emphasis: z
      .preprocess(
        safeCoerce(coerceAnimationEmphasis, ANIMATION_EMPHASIS_CANONICAL),
        z.enum(ANIMATION_EMPHASIS_CANONICAL),
      )
      .default("none"),
    exit: z
      .preprocess(
        safeCoerce(coerceAnimationExit, ANIMATION_EXIT_CANONICAL),
        z.enum(ANIMATION_EXIT_CANONICAL),
      )
      .default("none"),
  })
  .strict();

/**
 * `captions` — on-screen text for the scene (§16: burn-in captions).
 * `source: narration` derives the text from the scene's narration (CJK-
 * aware wrapped by the compiler); `text` overrides verbatim; `none`
 * disables. The compiled lines feed BOTH the burned-in overlay and the
 * safe-area validation (≤ 3 wrapped lines of 24 units).
 */
const captionsSchema = z
  .object({
    source: z.preprocess(
      safeCoerce(coerceCaptionsSource, CAPTIONS_SOURCE_CANONICAL),
      z.enum(CAPTIONS_SOURCE_CANONICAL),
    ),
    text: z.string().optional(),
    /**
     * CS-03: the scene's SPOKEN length, when it is shorter than the
     * scene. The scene is speech plus a held silence, and the caption
     * cues must be timed against the speech — timing them across the
     * whole scene would make the text drift late by the length of the
     * hold. Written by sync-durations, which measures the audio.
     */
    speech_sec: z.number().positive().optional(),
    /**
     * Yellow-highlighter phrases: the captions overlay wraps each
     * occurrence in a pale-yellow pill so the viewer's eye lands on the
     * term. Phrases are matched greedy-left in source order; a wrap that
     * splits a phrase across two cue lines will only highlight the part
     * on the line where the match starts.
     */
    highlight_terms: z.array(z.string().min(1)).optional(),
  })
  .strict();

/**
 * `transition` — how the scene enters and leaves (plan §8). `in: fade`
 * eases the scene up from the background over its first moments; `out:
 * fade` dissolves to the background at the end. `cut` renders at full
 * opacity from the first frame — a hard switch with no animation. The
 * window scales with fps (0.6 s wall-clock at any frame rate). Omitted →
 * both default to fade (0.1 storyboards never declared transitions and
 * always faded).
 */
const transitionSchema = z
  .object({
    in: z.preprocess(
      safeCoerce(coerceTransition, TRANSITION_CANONICAL),
      z.enum(TRANSITION_CANONICAL),
    ),
    out: z.preprocess(
      safeCoerce(coerceTransition, TRANSITION_CANONICAL),
      z.enum(TRANSITION_CANONICAL),
    ),
  })
  .strict();

const sceneSchema = z
  .object({
    id: z.string().min(1),
    duration: z.number().positive(),
    narration: narrationSchema.optional(),
    visual: visualSchema,
    animation: animationSchema.optional(),
    /**
     * Timeline animation model (plan §10) — the scene's choreography, in
     * scene-relative SECONDS. Each entry animates ONE named element
     * (`target`) with one verb (`type`) between `start` and
     * `start + duration` (must fit inside the scene — the validator
     * enforces this), eased by `easing`.
     *
     * What each type does per scene family:
     * - `draw`      — canvas: pen strokes; remotion components:
     *                 wipe-style reveal
     * - `write`     — text appears as if written/typed (Terminals,
     *                 CodeBlocks, labels)
     * - `fade`      — opacity fade-in (the gentle default)
     * - `move`      — translate from off/offset position into place
     * - `scale`     — grow/pop into place
     * - `rotate`    — rotation reveal
     * - `highlight` — a marker ring while the window lasts; a good
     *                 "this part matters" beat mid-scene
     * - `morph`     — reserved (not yet drawn differently from fade)
     *
     * Elements with no explicit entry fall back to the family default —
     * canvas scenes auto-draw sequentially so a minimal storyboard
     * still animates. `target` refers to an element id inside the
     * scene's props (DoodleScene stroke id).
     */
    animations: z.array(timelineAnimationSchema).optional(),
    captions: captionsSchema.optional(),
    transition: transitionSchema.optional(),
    /**
     * CS-03: seconds of silence held after this scene's narration. The
     * scene's duration is speech + this hold, and the narration wav
     * carries the silence too, so the audio track and the picture stay
     * the same length.
     */
    hold_after_sec: z.number().min(0).max(30).optional(),
    /**
     * Seconds of silence BEFORE this scene's narration — the opening
     * beat. The narration wav carries the silence at its front, so the
     * scene's duration is lead-in + speech + hold, and the caption cues
     * are offset by the lead-in so the text appears with the voice.
     */
    lead_in_sec: z.number().min(0).max(10).optional(),
    /**
     * CS-06 — a text layer composited OVER the scene's own image. It
     * never replaces the picture and never becomes its own scene: the
     * film's title sits in the opening shot's quiet area and fades, and a
     * chapter name appears only when a section turn earns one.
     *
     * `title` and `chapter` are independent — a scene may carry either,
     * both, or neither. The window is scene-relative seconds.
     */
    overlay: z
      .object({
        title: z.string().min(1).optional(),
        chapter: z.string().min(1).optional(),
        position: z.enum(["top", "bottom"]).default("top"),
        /** Scene-relative seconds. Defaults to the scene's own span. */
        start_sec: z.number().min(0).optional(),
        end_sec: z.number().min(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const defaultsSchema = z
  .object({
    renderer: z
      .preprocess(
        safeCoerce(coerceVisualRenderer, VISUAL_RENDERER_CANONICAL),
        z.enum(VISUAL_RENDERER_CANONICAL),
      )
      .optional(),
  })
  .strict();

const storyboardObjectSchema = z
  .object({
    schema_version: z.enum(["0.1", "0.2"]).default("0.2"),
    project: projectSchema,
    style: styleSchema.optional(),
    /** Project-level defaults: scenes that omit visual.renderer inherit
     * from here (per-scene values always win; final fallback "remotion"). */
    defaults: defaultsSchema.optional(),
    /** Project-level asset manifest (plan §11). */
    assets: z.array(assetSchema).optional(),
    scenes: z.array(sceneSchema).min(1),
  })
  .strict()
  .superRefine((board, ctx) => {
    // CS-14: a channel profile allows at most ONE full-frame map insert
    // per film, and the map may not be split into panels. Gated on the
    // profile — a board with no channel_profile is unchanged, and only
    // the profile's own docs describe the one-insert rule.
    if (board.style?.channel_profile !== "chinese-storybook") return;
    const mapScenes = board.scenes.filter(
      (s) => s.visual.component === "MapInsert",
    );
    if (mapScenes.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenes"],
        message: `channel_profile chinese-storybook allows one map insert per film, found ${mapScenes.length} (${mapScenes.map((s) => s.id).join(", ")})`,
      });
    }
  });

/** Renderer inheritance: scene.visual.renderer ?? defaults.renderer ??
 * "remotion", resolved at parse time so the compiled vdsl.yaml and the
 * RenderPlan always carry explicit per-scene renderers (determinism).
 * Strict by design — an inherited renderer that doesn't fit a scene's
 * component still fails loudly in assertPlanRenderable; no silent
 * family-aware fallback (§ "Silent fallback would render the wrong
 * thing; the CLI should stop instead"). */
function applyRendererDefaults(board: z.infer<typeof storyboardObjectSchema>) {
  const fallback = board.defaults?.renderer;
  return {
    ...board,
    scenes: board.scenes.map((scene) => ({
      ...scene,
      visual: {
        ...scene.visual,
        renderer: scene.visual.renderer ?? fallback ?? "remotion",
      },
    })),
  };
}

export const storyboardSchema = storyboardObjectSchema.transform(
  applyRendererDefaults,
);
export type Storyboard = z.output<typeof storyboardSchema>;
export type Scene = Storyboard["scenes"][number];
export type TimelineAnimation = z.infer<typeof timelineAnimationSchema>;
export type Asset = z.infer<typeof assetSchema>;

export const ANIMATION_ENTRANCES = ANIMATION_ENTRANCE_CANONICAL;
export const ANIMATION_TYPES = ANIMATION_TYPE_CANONICAL;
export const EASINGS = EASING_CANONICAL;
export const VISUAL_RENDERERS = VISUAL_RENDERER_CANONICAL;
export const ASSET_TYPES = ASSET_TYPE_CANONICAL;
