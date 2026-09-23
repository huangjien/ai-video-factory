import { z } from "zod";

/** Audio-config.yaml schema — the second human-edit artifact. Captures
 * everything audio-related in one file the human edits in 5 seconds. */

export const AudioConfigSchema = z.object({
  /** Edge TTS voice ID. Defaulted by the planner per language. */
  voice: z.string().min(1).optional(),
  /** BGM tag (mock) or filename (file-based). Use null to disable BGM. */
  bgm: z.string().nullable().optional(),
  bgm_fade_in_sec: z.number().min(0).max(10).optional(),
  bgm_fade_out_sec: z.number().min(0).max(10).optional(),
  /** Seconds of silence inserted between sentences in TTS output.
   * 0 disables; 0.3–1.5 typical. Honored via SSML `<break>`. */
  pause_between_sentences_sec: z.number().min(0).max(5).optional(),
  /** SFX cues keyed by scene id (e.g. scene_2). */
  sfx: z.record(z.string().min(1)).optional(),
});
export type AudioConfig = z.infer<typeof AudioConfigSchema>;

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  voice: undefined,
  bgm: "calm",
  bgm_fade_in_sec: 1.5,
  bgm_fade_out_sec: 2.0,
  pause_between_sentences_sec: 0,
  sfx: {},
};
