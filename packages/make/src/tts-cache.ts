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
  providerName = "edge",
): string {
  // The provider must be part of the key: "narrator-zh" through Voicebox and
  // "zh-CN-YunjianNeural" through Edge are different audio, and a provider
  // switch with an unchanged (voice, pause, narration) triple would otherwise
  // silently replay the old bytes. "" for the historical default keeps every
  // existing sidecar valid — re-hashing four shipped projects buys nothing.
  // ("fake" gets its own namespace too, which also stops --fake runs from
  // poisoning a later real run's cache — a pre-existing latent bug.)
  const providerTag = providerName === "edge" ? "" : providerName;
  const parts =
    providerTag === ""
      ? [voice, String(pauseSec ?? "-"), narration.trim()]
      : [providerTag, voice, String(pauseSec ?? "-"), narration.trim()];
  return "sha256:" + createHash("sha256").update(parts.join("\u0000")).digest("hex");
}
