import { existsSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { wrapText } from "@vf/media";
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
const CAPTION_MAX_LINES = 3;
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
        scene.visual.component === "Image" &&
        typeof props.data.src === "string"
      ) {
        const src = path.join(opts.projectRoot, props.data.src);
        if (!existsSync(src)) {
          errors.push({
            file,
            field: `${base.join(".")}.visual.props.src`,
            line: line([...base, "visual", "props"]),
            message: `Image file not found: ${props.data.src} (resolved against project root).`,
          });
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
