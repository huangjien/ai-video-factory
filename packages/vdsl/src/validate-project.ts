import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod/v3";
import {
  buildCaptionCues,
  CAPTION_LINE_UNITS,
  MAX_CAPTION_LINES,
  wrapText,
} from "@video/media";
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
  /** Scene-clip probe (geometry/duration/audio) — injectable like
   *  `probeAudio` so tests can fake it. Returning null = "unreadable",
   *  which is an error finding. Absent → only file-existence and
   *  attribution checks run (no ffprobe). */
  probeVideo?: (file: string) => Promise<{
    width: number;
    height: number;
    durationSec: number;
    hasAudio: boolean;
  } | null>;
}

// Caption constraints are checked on the timed cues produced by the same
// builder used by rendering and SRT export. Checking the whole scene as one
// static block incorrectly rejected long narration and pushed callers toward
// `captions_source: caption`, which repeats the scene title at the bottom.
const AUDIO_TOLERANCE_S = 0.05;

/** Full project-level validation (§21.1 lines 926-930): registry membership,
 * props schema, asset existence, audio-vs-scene duration, timed-caption safe area.
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
          message: `Animation "${anim.id}" (${anim.type}) runs ${(anim.start + anim.duration).toFixed(2)}s but scene duration is ${scene.duration}s — it would be clipped.`,
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
      const cues = buildCaptionCues(captionText, scene.duration);
      const oversizedCue = cues.find(
        (cue) =>
          cue.lines.length > MAX_CAPTION_LINES ||
          cue.lines.some((captionLine) => {
            const wrapped = wrapText(captionLine, CAPTION_LINE_UNITS);
            return wrapped.length !== 1 || wrapped[0] !== captionLine;
          }),
      );
      if (oversizedCue !== undefined) {
        errors.push({
          file,
          field: `${base.join(".")}.captions`,
          line: line([...base, "captions"]),
          message: `A timed caption cue exceeds ${MAX_CAPTION_LINES} lines or ${CAPTION_LINE_UNITS} zh units per line — exceeds the bottom safe area (§62.4 line 2300).`,
          fix: "Split the caption into shorter timed cues.",
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Public-domain scene clips (docs/plans/2026-11-21-public-domain-video-
  // scenes-design.md): any `assets/video/scene_N.mp4` must be renderable
  // (geometry, silent, covers the scene) AND audited (sidecar with a free
  // licence). A clip without its sidecar would put footage on screen with
  // no provenance — error-level, like a missing image.
  const videoDir = path.join(opts.projectRoot, "assets", "video");
  const clipFiles = existsSync(videoDir)
    ? readdirSync(videoDir)
        .filter((f) => /^scene_\d+\.mp4$/.test(f))
        .sort()
    : [];
  for (const clipFile of clipFiles) {
    const n = parseInt(clipFile.match(/^scene_(\d+)\.mp4$/)?.[1] ?? "0", 10);
    const clipAbs = path.join(videoDir, clipFile);
    const field = `assets.video.${clipFile}`;
    const scene = scenes.find((s) => {
      const idNum = s.id.match(/scene[-_]?(\d+)/)?.[1];
      return idNum !== undefined && parseInt(idNum, 10) === n;
    });
    if (!scene) {
      errors.push({
        file,
        field,
        line: 0,
        message: `Clip ${clipFile} has no matching scene (scene ${n} is not in this storyboard) — delete it or rename.`,
        fix: "Remove the stale clip, or re-run `video make --video-sources on`.",
      });
      continue;
    }
    const sidecarPath = path.join(videoDir, `scene_${n}.source.json`);
    if (!existsSync(sidecarPath)) {
      errors.push({
        file,
        field,
        line: 0,
        message: `Clip ${clipFile} has no attribution sidecar (scene_${n}.source.json) — footage on screen without provenance is unshippable.`,
        fix: "Re-run `video make --video-sources on` to re-retrieve with attribution.",
      });
    } else {
      try {
        const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as {
          schema?: string;
          license?: string;
        };
        if (sidecar.schema !== "scene-video-source/1") {
          errors.push({
            file,
            field: `${field}.sidecar`,
            line: 0,
            message: `Clip sidecar for scene ${n} is not scene-video-source/1 — rewrite it with \`video make --video-sources on\`.`,
          });
        } else if (!["PD", "CC0", "PDM"].includes(sidecar.license ?? "")) {
          errors.push({
            file,
            field: `${field}.sidecar`,
            line: 0,
            message: `Clip for scene ${n} carries licence "${sidecar.license ?? ""}" — only PD / CC0 / PDM may ship.`,
          });
        }
      } catch {
        errors.push({
          file,
          field: `${field}.sidecar`,
          line: 0,
          message: `Clip sidecar for scene ${n} is not valid JSON.`,
        });
      }
    }
    if (opts.probeVideo === undefined) continue;
    const meta = await opts.probeVideo(clipAbs);
    if (meta === null) {
      errors.push({
        file,
        field,
        line: 0,
        message: `Clip ${clipFile} is unreadable by ffprobe — re-run \`video make --video-sources on\`.`,
      });
      continue;
    }
    if (meta.width !== 1080 || meta.height !== 1920) {
      errors.push({
        file,
        field,
        line: 0,
        message: `Clip ${clipFile} is ${meta.width}x${meta.height} — scene clips must be 1080x1920 (the preprocess step enforces this).`,
        fix: "Re-run `video make --video-sources on`.",
      });
    }
    if (meta.hasAudio) {
      errors.push({
        file,
        field,
        line: 0,
        message: `Clip ${clipFile} carries an audio track — scene audio is narration + BGM only; the preprocess step strips it.`,
        fix: "Re-run `video make --video-sources on`.",
      });
    }
    if (meta.durationSec < scene.duration - 0.5) {
      errors.push({
        file,
        field,
        line: 0,
        message: `Clip ${clipFile} runs ${meta.durationSec.toFixed(2)}s but scene ${n} lasts ${scene.duration}s — it cannot cover the scene.`,
        fix: "Re-run `video make --video-sources on`, or pick a longer clip.",
      });
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
