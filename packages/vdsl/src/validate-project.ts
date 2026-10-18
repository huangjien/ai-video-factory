import { existsSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { wrapText } from "@video/media";
import type { VdslError } from "./errors.js";
import { lineOf, parseYaml } from "./parse.js";
import type { Storyboard } from "./schema.js";
import { validateStoryboard, type ValidationResult } from "./validate.js";

export interface ComponentRegistryEntry {
  propsSchema: z.ZodTypeAny;
}
export type ComponentRegistry = Record<string, ComponentRegistryEntry>;

export interface ValidateProjectOptions {
  projectRoot: string;
  registry: ComponentRegistry;
  probeAudio?: (file: string) => Promise<number>;
}

const CAPTION_MAX_UNITS = 24;
// 2026-10-18: bumped 3 → 4 lines. The storyboard LLM naturally produces
// 70-80 zh-char narrations that wrap to 4 lines at 24 zh/line; rejecting
// them blocked every make run. Four lines is the render captionStyle's
// practical ceiling (bottom safe area overflows on the 4th line for
// 4-character zh lines — acceptable for this project; revisit if a
// shorter narration strategy lands).
const CAPTION_MAX_LINES = 4;
const AUDIO_TOLERANCE_S = 0.05;

/** Full project-level validation (§21.1 lines 926-930): registry membership,
 * props schema, asset existence, audio-vs-scene duration, caption safe area.
 * Shape rules run first; failures never auto-retry (§62.1 line 2221). */
export async function validateProject(
  text: string,
  file: string,
  opts: ValidateProjectOptions,
): Promise<ValidationResult> {
  const shape = validateStoryboard(text, file);
  if (!shape.ok) return shape;

  const parsed = parseYaml(text);
  const doc = parsed.ok ? parsed.doc : undefined;
  const line = (scenePath: (string | number)[]): number =>
    doc ? lineOf(doc, text, scenePath) : 0;

  const errors: VdslError[] = [];
  const registered = Object.keys(opts.registry);

  const scenes: Storyboard["scenes"] = shape.data.scenes;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (!scene) continue;
    const base: (string | number)[] = ["scenes", i];

    const entry = opts.registry[scene.visual.component];
    if (!entry) {
      errors.push({
        file,
        field: `${base.join(".")}.visual.component`,
        line: line([...base, "visual", "component"]),
        message: `Component "${scene.visual.component}" is not registered (§21.1 line 928). Registered components: ${registered.join(", ")}.`,
      });
    } else {
      const props = entry.propsSchema.safeParse(scene.visual.props);
      if (!props.success) {
        for (const issue of props.error.issues) {
          errors.push({
            file,
            field: `${base.join(".")}.visual.props.${issue.path.join(".")}`,
            line: line([...base, "visual", "props"]),
            message: `${scene.visual.component}: ${issue.message}`,
          });
        }
      } else if (
        (scene.visual.component === "Image" ||
          scene.visual.component === "ImageBackground") &&
        typeof props.data.src === "string"
      ) {
        // The image step writes absolute src; path.join with an
// absolute segment on this Node version concatenates rather than
// replaces — detect and use the absolute path verbatim.
        const src = path.isAbsolute(props.data.src)
          ? props.data.src
          : path.join(opts.projectRoot, props.data.src);
        if (!existsSync(src)) {
          errors.push({
            file,
            field: `${base.join(".")}.visual.props.src`,
            line: line([...base, "visual", "props"]),
            message: `${scene.visual.component} file not found: ${props.data.src} (resolved against project root).`,
          });
        }
      }
    }

    const anims = scene.animations ?? [];

    // Timeline animation targets must name a real element: a typo'd target
    // silently no-ops (doodleLogic falls back to the default stagger).
    // Cheap to check only where element ids are declared in props —
    // canvas (strokes) scenes. Remotion components have no enumerable
    // element ids, so they are skipped.
    if (anims.length > 0 && scene.visual.renderer === "canvas") {
      const ids = sceneElementIds(scene.visual.props);
      if (ids !== null) {
        // The scene's own id (and the literal "root") target the SCENE
        // ROOT — a legitimate hand-authored pattern (the shipped
        // mcp-explainer example uses it for whole-scene entrances), not a
        // typo. Anything else outside the element set is the typo case.
        ids.add(scene.id);
        ids.add("root");
        for (let a = 0; a < anims.length; a++) {
          const anim = anims[a];
          if (!anim) continue;
          if (!ids.has(anim.target)) {
            errors.push({
              file,
              field: `${base.join(".")}.animations.${a}.target`,
              line: line([...base, "animations", a]),
              message: `Animation "${anim.id}" targets "${anim.target}", which is not an element id of this ${scene.visual.renderer} scene (known: ${[...ids].join(", ")}).`,
              fix: "Fix the target id, or remove the entry to fall back to the default stagger.",
            });
          }
        }
      }
    }

    if (scene.narration?.audio) {
      const audioAbs = path.join(opts.projectRoot, scene.narration.audio);
      if (!existsSync(audioAbs)) {
        errors.push({
          file,
          field: `${base.join(".")}.narration.audio`,
          line: line([...base, "narration", "audio"]),
          message: `Audio file not found: ${scene.narration.audio} (resolved against project root).`,
        });
      } else if (opts.probeAudio) {
        const audioDuration = await opts.probeAudio(audioAbs);
        if (audioDuration > scene.duration + AUDIO_TOLERANCE_S) {
          errors.push({
            file,
            field: `${base.join(".")}.narration.audio`,
            line: line([...base, "narration", "audio"]),
            message: `Audio duration ${audioDuration}s is longer than scene duration ${scene.duration}s (tolerance ${AUDIO_TOLERANCE_S}s) — §62.4 line 2299.`,
            fix: "Trim the audio or increase the scene duration.",
          });
        }
      }
    }

    // Timeline animations (plan §10) must fit inside the scene: they are
    // scene-relative seconds and silently overflowing would get clipped
    // at render time.
    for (let a = 0; a < anims.length; a++) {
      const anim = anims[a];
      if (!anim) continue;
      if (anim.start + anim.duration > scene.duration + AUDIO_TOLERANCE_S) {
        errors.push({
          file,
          field: `${base.join(".")}.animations.${a}`,
          line: line([...base, "animations", a]),
          message: `Animation "${anim.id}" (${anim.type}) runs ${ (anim.start + anim.duration).toFixed(2) }s but scene duration is ${scene.duration}s — it would be clipped.`,
          fix: "Shorten the animation or increase the scene duration.",
        });
      }
    }

    const captionText =
      scene.captions?.text ??
      (scene.captions?.source === "narration"
        ? scene.narration?.text
        : undefined);
    if (captionText !== undefined) {
      const lines = wrapText(captionText, CAPTION_MAX_UNITS);
      if (lines.length > CAPTION_MAX_LINES) {
        errors.push({
          file,
          field: `${base.join(".")}.captions`,
          line: line([...base, "captions"]),
          message: `Captions wrap to ${lines.length} lines (max ${CAPTION_MAX_LINES} x ${CAPTION_MAX_UNITS} zh units) — exceeds the bottom safe area (§62.4 line 2300).`,
          fix: "Shorten the caption text or split into more scenes.",
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: shape.data };
}

/** Element ids declared in canvas scene props (DoodleScene strokes).
 * Null when none are declared — the caller skips target validation
 * rather than guessing. */
function sceneElementIds(props: unknown): Set<string> | null {
  if (props === null || typeof props !== "object") return null;
  const ids = new Set<string>();
  // Named cast: props is a yaml-parsed object; per-key reads are guarded.
  const obj = props as Record<string, unknown>;
  for (const key of ["strokes"]) {
    const arr: unknown = obj[key];
    if (!Array.isArray(arr)) continue;
    for (const el of arr) {
      if (el !== null && typeof el === "object" && "id" in el) {
        const id: unknown = el.id;
        if (typeof id === "string" && id.length > 0) ids.add(id);
      }
    }
  }
  return ids.size > 0 ? ids : null;
}
