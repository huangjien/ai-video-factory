import { z } from "zod";
import { parse as parseYaml } from "yaml";

/**
 * `audio-assets/mix.yaml` convention for v0.3.5:
 *   bgm: <tag>                     # tag into assets/audio-assets/bgm/
 *   sfx:                           # optional, scene-keyed SFX cues
 *     scene_2: whoosh
 *     scene_4: ding
 *   bgm_fade_in_sec: <number>      # optional, fade BGM in over N seconds
 *   bgm_fade_out_sec: <number>     # optional, fade BGM out over last N seconds
 *
 * Used by `vf mix` and `vf final --mix`. Human-authored per project.
 */
export const SfxCueKeySchema = z
  .string()
  .regex(/^scene_\d+$/, "sfx cue keys must be scene_N (e.g. scene_2)");

export const MixSpecSchema = z
  .object({
    bgm: z.string().min(1).optional(),
    sfx: z
      .record(SfxCueKeySchema, z.string().min(1))
      .optional(),
    bgm_fade_in_sec: z.number().nonnegative().optional(),
    bgm_fade_out_sec: z.number().nonnegative().optional(),
  })
  .strict();

export type MixSpec = z.infer<typeof MixSpecSchema>;

export function parseMixYaml(yamlText: string): MixSpec {
  const parsed = parseYaml(yamlText);
  const result = MixSpecSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `invalid mix.yaml: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return result.data;
}
