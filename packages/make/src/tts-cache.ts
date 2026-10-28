import { createHash } from "node:crypto";
import type { ParsedArticle } from "@video/draft";
import {
  MINIMAX_DEFAULT_MODEL,
  defaultVoiceForProvider,
  edgeSystemVoice,
} from "@video/tts";

/**
 * TTS cache key + default voices (v0.8 G2: extracted from index.ts so the
 * read-only impact report can import them without an import cycle —
 * index → impact → tts-cache is acyclic).
 *
 * Default: the MiniMax system narrator (speech-2.8-hd). The Edge system
 * voices live in EDGE_SYSTEM_VOICE (@video/tts) and are used only when the
 * project pins the Edge backend.
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

export const ZH_VOICE = edgeSystemVoice("zh-CN");
export const EN_VOICE = edgeSystemVoice("en-US");

/** Effective narration voice for an article: frontmatter `voice:` wins,
 *  else the default voice for the article's BACKEND. The one resolution
 *  rule shared by runTts and the dry-run impact table — two copies of
 *  this `||` already diverged once (the impact table used to read
 *  audio-config.yaml's `voice:`, which make ignores on the synthesis
 *  path, so the table lied).
 *
 *  The fallback follows the provider, because a voice id only means
 *  anything to the backend that owns it: an Edge id handed to MiniMax
 *  (or the reverse) fails at synthesis, not at config time. */
export function effectiveTtsVoice(
  frontmatterVoice: string | undefined,
  language: string,
  ttsProvider?: string | undefined,
): string {
  if (frontmatterVoice) return frontmatterVoice;
  if (ttsProvider === undefined) return edgeSystemVoice(language);
  return defaultVoiceForProvider(ttsProvider, language);
}

/** The model a provider serves, for the cache key.
 *
 * MiniMax has more than one T2A tier and the tiers are different audio:
 * `speech-2.8-hd` and `speech-2.8-turbo` produce different bytes for
 * the same (text, voice). The provider NAME alone cannot tell them
 * apart, so the model joins the key — otherwise switching the default
 * tier would silently replay the old audio forever.
 *
 * Both the render and the dry-run table call this with their provider
 * name, so the two cannot disagree about which tier they mean. */
export function ttsCacheModelFor(providerName: string): string | undefined {
  if (providerName === "minimax-tts") return MINIMAX_DEFAULT_MODEL;
  return undefined;
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

/**
 * One scene's narration, as the TTS step sees it.
 *
 * The hold and the lead-in are silence PADDED INTO the wav, so they change
 * the bytes exactly as much as the voice does — they belong to the scene's
 * identity, not to the render settings.
 */
export interface TtsScene {
  id: string;
  narration: string;
  durationSec: number;
  /** CS-03 hold: silence padded INTO the wav after the voice stops. */
  holdAfterSec?: number | undefined;
  /** The opening beat: silence padded into the FRONT of the wav, so
   *  the voice enters after the picture has settled. */
  leadInSec?: number | undefined;
}

/** The voice settings the cache key depends on. */
export interface TtsSettings {
  /** The voice id in use. */
  voice: string;
  /** Seconds of pause between sentences. */
  pauseSec: number | undefined;
  /** The serving provider's name — "edge", "minimax-tts", "voicebox". */
  providerName: string;
  /** The article's language. */
  language: string;
  /**
   * Voicebox playback rate and its inter-sentence pause. Both change the
   * bytes that come back, so both belong in the key: a project that
   * lowered `tts_speed` to slow the narrator down would otherwise keep
   * replaying the old audio at the old pace, with nothing in the log to
   * say so. Left undefined, the tags are omitted entirely — that keeps
   * every pre-existing sidecar valid, the same way the provider and
   * language tags above do it.
   */
  voiceboxSpeed: number | undefined;
  voiceboxSentencePauseSec: number | undefined;
  /**
   * The model the provider serves — undefined for backends with a single
   * output. See `ttsCacheModelFor`.
   */
  model: string | undefined;
}

/**
 * Everything the TTS cache key is computed from.
 *
 * Every field is REQUIRED, and may be undefined — a caller states every
 * input, so an input one of them forgets is a compile error rather than a
 * silent cache miss.
 */
export interface TtsCacheKeyInput {
  narration: string;
  voice: string;
  pauseSec: number | undefined;
  providerName: string;
  language: string;
  voiceboxSpeed: number | undefined;
  voiceboxSentencePauseSec: number | undefined;
  /** The scene's held silence. */
  holdAfterSec: number | undefined;
  /** Seconds of silence BEFORE the voice — the opening beat. */
  leadInSec: number | undefined;
  /**
   * The model the provider serves — undefined for backends with a single
   * output. Different tiers are different audio, so they cannot share a
   * cache slot.
   */
  model: string | undefined;
}

/**
 * The TTS inputs for an article's scenes.
 *
 * The hold and the lead-in are silence padded INTO the wav, so they change
 * the bytes exactly as much as the voice does — they are part of the
 * scene's identity. The render and the dry-run read them through here, so
 * one of them cannot pick up a field the other drops.
 */
export function ttsScenesFromArticle(article: ParsedArticle): TtsScene[] {
  return article.scenes.map((s) => ({
    id: s.id,
    narration: s.narration,
    durationSec: s.duration,
    holdAfterSec: s.hold_after_sec,
    leadInSec: s.lead_in_sec,
  }));
}

/**
 * Assemble the cache-key inputs for one scene.
 *
 * The render and the dry-run impact table both go through here, so they
 * cannot disagree about what the key is made of. They can still disagree
 * about the SETTINGS — the dry-run cannot probe whether Voicebox is up, so
 * it states the provider the frontmatter asks for — and that difference is
 * stated in one place instead of being spread across two call sites.
 */
export function ttsCacheInputsFor(
  scene: TtsScene,
  settings: TtsSettings,
): TtsCacheKeyInput {
  return {
    narration: scene.narration,
    voice: settings.voice,
    pauseSec: settings.pauseSec,
    providerName: settings.providerName,
    language: settings.language,
    voiceboxSpeed: settings.voiceboxSpeed,
    voiceboxSentencePauseSec: settings.voiceboxSentencePauseSec,
    holdAfterSec: scene.holdAfterSec,
    leadInSec: scene.leadInSec,
    model: settings.model,
  };
}

export function ttsCacheKey(input: TtsCacheKeyInput): string {
  const {
    narration,
    voice,
    pauseSec,
    providerName,
    language,
    voiceboxSpeed,
    voiceboxSentencePauseSec,
    holdAfterSec,
    leadInSec,
    model,
  } = input;
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
  // The model tag sits next to the provider tag: two MiniMax tiers are
  // two different voices' worth of audio. Omitted when the backend has a
  // single output, so every pinned Edge / Voicebox key stays put.
  const modelTag = model === undefined ? "" : `model${model}\u0000`;
  return (
    "sha256:" +
    createHash("sha256")
      .update(
        `${core}\u0000${modelTag}${pauseSec ?? "-"}\u0000${speedTag}${sentencePauseTag}${holdTag}${leadInTag}${revisionTag}${narration.trim()}`,
      )
      .digest("hex")
  );
}
