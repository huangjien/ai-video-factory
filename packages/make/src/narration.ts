import {
  EdgeTTSProvider,
  FakeTTSProvider,
  F5TTSProvider,
  MinimaxTTSProvider,
  VoiceboxTTSProvider,
  minimaxSystemVoice,
  type TTSProvider,
} from "@video/tts";
import { EN_VOICE, ZH_VOICE } from "./tts-cache.js";

export interface NarrationDecision {
  provider: TTSProvider;
  /** Voice id in the chosen provider's namespace — may differ from the
   * frontmatter voice when a fallback replaced the backend. */
  voice: string;
  warnings: string[];
}

/**
 * Decide the narration backend for `video make` (pure — no network here;
 * the caller probes Voicebox and passes the boolean).
 *
 * Policy (2026-10-18, f5tts added 2026-10-25): the user's declared backend
 * wins when its dependencies are up; otherwise degrade loudly, never
 * silently:
 *
 *   f5tts + install/ref missing → voicebox (the previous local clone)
 *   voicebox + server down  → MiniMax system voice (needs MINIMAX_API_KEY)
 *   voicebox + down + no key → Edge TTS default voice
 *   minimax + no key        → Edge TTS default voice
 *   unknown value           → warning + Edge (article.md is hand-edited)
 *
 * `--fake` short-circuits everything (tests must not probe localhost).
 */
export function resolveNarration(input: {
  fake: boolean;
  ttsProvider: string | undefined;
  voice: string;
  language: string;
  voiceboxHealthy: boolean;
  /** F5-TTS (MLX) install probe — interpreter + package + reference clip. */
  f5ttsAvailable?: boolean;
  minimaxKey: boolean;
  /** The project's `tts_speed`. Passed to whichever provider is chosen —
   *  Voicebox and MiniMax both honour it, Edge does not. */
  ttsSpeed?: number | undefined;
  voiceboxSpeed?: number | undefined;
  voiceboxSentencePauseSec?: number | undefined;
}): NarrationDecision {
  const warnings: string[] = [];
  if (input.fake) {
    return {
      provider: new FakeTTSProvider({ sampleBytes: 256 }),
      voice: input.voice,
      warnings,
    };
  }

  const edgeDefault = input.language === "en-US" ? EN_VOICE : ZH_VOICE;

  if (input.ttsProvider === "f5tts") {
    if (input.f5ttsAvailable) {
      return {
        provider: new F5TTSProvider(),
        voice: input.voice,
        warnings,
      };
    }
    warnings.push(
      `f5tts install/reference unavailable — falling back to voicebox clone`,
    );
    // Fall through: the voicebox chain below IS the backup the operator
    // asked to keep (voicebox → minimax → edge). Rebind the selector so
    // the voicebox branch matches.
    input = { ...input, ttsProvider: "voicebox" };
  }

  if (input.ttsProvider === "voicebox") {
    if (input.voiceboxHealthy) {
      return {
        provider: new VoiceboxTTSProvider({
          ...(input.voiceboxSpeed !== undefined
            ? { speed: input.voiceboxSpeed }
            : {}),
          ...(input.voiceboxSentencePauseSec !== undefined
            ? { sentencePauseSec: input.voiceboxSentencePauseSec }
            : {}),
        }),
        voice: input.voice,
        warnings,
      };
    }
    warnings.push(
      `voicebox-server unreachable (VOICEBOX_URL) — falling back to MiniMax system voice`,
    );
    if (input.minimaxKey) {
      return {
        provider: new MinimaxTTSProvider(),
        voice: minimaxSystemVoice(input.language),
        warnings,
      };
    }
    warnings.push("MINIMAX_API_KEY not set either — falling back to Edge TTS");
    return { provider: new EdgeTTSProvider(), voice: edgeDefault, warnings };
  }

  if (input.ttsProvider === "minimax") {
    if (input.minimaxKey) {
      // MiniMax accepts speed on the request (voice_setting.speed),
      // so honour the project's `tts_speed` here. It used to be passed
      // only to Voicebox, which meant switching a slowed project from
      // voicebox to minimax silently snapped it back to 1.0.
      return {
        provider: new MinimaxTTSProvider(
          input.ttsSpeed !== undefined ? { speed: input.ttsSpeed } : {},
        ),
        voice: input.voice,
        warnings,
      };
    }
    warnings.push(
      `tts_provider "minimax" needs MINIMAX_API_KEY — falling back to Edge TTS`,
    );
    return { provider: new EdgeTTSProvider(), voice: edgeDefault, warnings };
  }

  if (input.ttsProvider !== undefined && input.ttsProvider !== "edge") {
    warnings.push(
      `unknown tts_provider "${input.ttsProvider}" — falling back to Edge TTS`,
    );
  }
  return { provider: new EdgeTTSProvider(), voice: input.voice, warnings };
}
