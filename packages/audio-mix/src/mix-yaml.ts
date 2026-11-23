import { z } from "zod/v3";
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
 * LEGACY (2026-11-16): the pipeline has not written this file since
 * `audio-config.yaml` became the human-edit file, so the mixer reads it
 * as a FALLBACK — it only fills the gaps audio-config.yaml leaves, and
 * warns when it is there. This schema still validates the cue keys
 * (the same `scene_N` shape the current format uses), so a migrated
 * project keeps the same cue contract.
 */
export const SfxCueKeySchema = z
  .string()
  .regex(/^scene_\d+$/, "sfx cue keys must be scene_N (e.g. scene_2)");

export const MixSpecSchema = z
  .object({
    bgm: z.string().min(1).optional(),
    sfx: z.record(SfxCueKeySchema, z.string().min(1)).optional(),
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
