import { createHash } from "node:crypto";

/**
 * TTS cache key + default voices (v0.8 G2: extracted from index.ts so the
 * read-only impact report can import them without an import cycle —
 * index → impact → tts-cache is acyclic).
 *
 * Default: male narration voices. Female alternatives:
 * zh-CN-XiaoxiaoNeural, en-US-AriaNeural.
 */
/**
 * Bumped when the TTS provider's OUTPUT changes for the same inputs.
 * 2026-10-19 #2: the voicebox sentence stitch padded each piece by its own
 * duration, doubling every multi-sentence narration.
 * 2026-10-19 #3: the playback rate is now applied locally (the server has
 * no speed field), so the same inputs produce different bytes.
 * The cache key cannot see either, so the old bytes would be replayed
 * forever without this tag.
 */
export const TTS_PROVIDER_REVISION = "3";

export const ZH_VOICE = "zh-CN-YunjianNeural";
export const EN_VOICE = "en-US-ChristopherNeural";

/** Effective narration voice for an article: frontmatter `voice:` wins,
 *  else the language default. The one resolution rule shared by runTts and
 *  the dry-run impact table — two copies of this `||` already diverged
 *  once (the impact table used to read audio-config.yaml's `voice:`,
 *  which make ignores on the synthesis path, so the table lied). */
export function effectiveTtsVoice(
  frontmatterVoice: string | undefined,
  language: string,
): string {
  return frontmatterVoice || (language === "en-US" ? EN_VOICE : ZH_VOICE);
}

/** Cache provider-name for a frontmatter `tts_provider` value — mirrors
 *  the providers' `name` fields, since that is what runTts feeds
 *  ttsCacheKey. The dry-run cannot probe voicebox health or the MiniMax
 *  key, so a degraded run (voicebox down ⇒ minimax/edge) may still
 *  re-synthesize where the table said cached: over-report only. */
export function ttsCacheProviderName(
  frontmatterTtsProvider: string | undefined,
): string {
  if (frontmatterTtsProvider === "voicebox") return "voicebox";
  if (frontmatterTtsProvider === "minimax") return "minimax-tts";
  return "edge";
}

export function ttsCacheKey(
  narration: string,
  voice: string,
  pauseSec: number | undefined,
  providerName = "edge",
  language: string,
  /**
   * Voicebox playback rate and its inter-sentence pause. Both change the
   * bytes that come back, so both belong in the key: a project that
   * lowered `tts_speed` to slow the narrator down would otherwise keep
   * replaying the old audio at the old pace, with nothing in the log to
   * say so. Left undefined, the tags are omitted entirely — that keeps
   * every pre-existing sidecar valid, the same way the provider and
   * language tags above do it.
   */
  voiceboxSpeed?: number,
  voiceboxSentencePauseSec?: number,
  /** CS-03: the scene's held silence. It is padded INTO the wav, so it
   *  changes the bytes just as much as the speed does. */
  holdAfterSec?: number,
  /** Seconds of silence BEFORE the voice — the opening beat. Padded into
   *  the front of the wav, so it changes the bytes too. */
  leadInSec?: number,
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
  const revisionTag = `${TTS_PROVIDER_REVISION}\u0000`;
  const langTag = language === "" ? "" : `${language}\u0000`;
  const core =
    providerTag === ""
      ? `${langTag}${voice}`
      : `${providerTag}\u0000${langTag}${voice}`;
  const speedTag = voiceboxSpeed === undefined ? "" : `${voiceboxSpeed}\u0000`;
  const holdTag = holdAfterSec === undefined ? "" : `${holdAfterSec}\u0000`;
  // The lead-in tag is prefixed so it can never collide with the hold
  // tag, and it is omitted entirely when there is no lead-in — the
  // pinned key for a plain scene must not move.
  const leadInTag = leadInSec === undefined ? "" : `lead${leadInSec}\u0000`;
  const sentencePauseTag =
    voiceboxSentencePauseSec === undefined
      ? ""
      : `${voiceboxSentencePauseSec}\u0000`;
  return (
    "sha256:" +
    createHash("sha256")
      .update(
        `${core}\u0000${pauseSec ?? "-"}\u0000${speedTag}${sentencePauseTag}${holdTag}${leadInTag}${revisionTag}${narration.trim()}`,
      )
      .digest("hex")
  );
}
