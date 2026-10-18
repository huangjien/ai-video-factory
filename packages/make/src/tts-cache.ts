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
  language: string,
): string {
  // The provider must be part of the key: "narrator-zh" through Voicebox and
  // "zh-CN-YunjianNeural" through Edge are different audio, and a provider
  // switch with an unchanged (voice, pause, narration) triple would otherwise
  // silently replay the old bytes. "" for the historical default keeps every
  // pre-provider sidecar valid — re-hashing four shipped projects buys
  // nothing. ("fake" gets its own namespace too, which also stops --fake
  // runs from poisoning a later real run's cache — a pre-existing latent
  // bug.)
  //
  // language joins the key 2026-10-18: cloned/custom voice ids do NOT
  // encode the language the way Edge ids do ("narrator-zh" is a name, not
  // a locale), so the same voice id in a zh-CN and an en-US article must
  // not share audio. This DOES invalidate every pre-existing sidecar once
  // (all Edge, free to re-synthesize) — pinned in tts-cache.test.ts.
  const providerTag = providerName === "edge" ? "" : providerName;
  const langTag = language === "" ? "" : `${language}\u0000`;
  const core =
    providerTag === ""
      ? `${langTag}${voice}`
      : `${providerTag}\u0000${langTag}${voice}`;
  return (
    "sha256:" +
    createHash("sha256")
      .update(`${core}\u0000${pauseSec ?? "-"}\u0000${narration.trim()}`)
      .digest("hex")
  );
}
