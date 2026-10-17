import { createHash } from "node:crypto";

/**
 * TTS cache key + default voices (v0.8 G2: extracted from index.ts so the
 * read-only impact report can import them without an import cycle —
 * index → impact → tts-cache is acyclic).
 *
 * Default: male narration voices. Female alternatives:
 * zh-CN-XiaoxiaoNeural, en-US-AriaNeural.
 */
export const ZH_VOICE = "zh-CN-YunjianNeural";
export const EN_VOICE = "en-US-ChristopherNeural";

export function ttsCacheKey(
  narration: string,
  voice: string,
  pauseSec: number | undefined,
): string {
  return (
    "sha256:" +
    createHash("sha256")
      .update(`${voice}\u0000${pauseSec ?? "-"}\u0000${narration.trim()}`)
      .digest("hex")
  );
}
