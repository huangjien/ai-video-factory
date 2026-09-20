import { z } from "zod";

/** Background-music / sound-effect asset provider abstraction (doc §60
 * "Advanced Audio"). v0.3.3 ships two provider implementations:
 *   - MockAudioAssetProvider (default, deterministic local lookup)
 *   - FileBasedAudioAssetProvider (real local files in a user directory)
 * Real providers (Suno, ElevenLabs, etc.) plug into the same interface —
 * the abstraction is the contract that holds. */

export const BgmOptionsSchema = z
  .object({
    tag: z.string().min(1).optional(),
    maxDurationSec: z.number().positive().optional(),
    mood: z.string().optional(),
  })
  .strict();

export const SfxOptionsSchema = z
  .object({
    tag: z.string().min(1),
    durationSec: z.number().positive().optional(),
  })
  .strict();

export const AssetResultSchema = z
  .object({
    bytes: z.instanceof(Uint8Array),
    contentType: z.enum(["audio/wav", "audio/mpeg", "audio/ogg"]),
    durationSec: z.number().positive(),
    license: z.string().min(1),
    source: z.string().min(1),
  })
  .strict();

export type BgmOptions = z.infer<typeof BgmOptionsSchema>;
export type SfxOptions = z.infer<typeof SfxOptionsSchema>;
export type AssetResult = z.infer<typeof AssetResultSchema>;

export interface AudioAssetProvider {
  readonly name: string;
  pickBackgroundMusic(opts?: BgmOptions): Promise<AssetResult>;
  pickSoundEffect(opts: SfxOptions): Promise<AssetResult>;
}

export class AudioAssetError extends Error {
  readonly provider: string;
  constructor(message: string, provider: string) {
    super(message);
    this.name = "AudioAssetError";
    this.provider = provider;
  }
}
