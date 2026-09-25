import type { Provider } from "@vf/llm";
import { chatWithFallback } from "@vf/llm";
import { parse as parseYaml } from "yaml";
import { buildMessages, type AudioPlanInput } from "./prompt.js";
import { AudioConfigSchema, DEFAULT_AUDIO_CONFIG, type AudioConfig } from "./schemas.js";

export class AudioPlanError extends Error {
  override readonly cause: unknown;
  constructor(
    message: string,
    public readonly providerName: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "AudioPlanError";
    this.cause = cause;
  }
}

export interface CallAudioPlanResult {
  config: AudioConfig;
  /** Serialized audio-config.yaml the human can edit. */
  yaml: string;
  usage: { input: number; output: number };
  /** Name of the provider that actually served the request
   * (primary or its fallback, per `chatWithFallback`). */
  providerName: string;
}

/** Render AudioConfig to YAML — keys in a stable order, comments off by default. */
export function renderAudioConfig(c: AudioConfig): string {
  const lines: string[] = [];
  if (c.voice) lines.push(`voice: ${c.voice}`);
  lines.push(`bgm: ${c.bgm === null ? "null" : JSON.stringify(c.bgm)}`);
  lines.push(`bgm_fade_in_sec: ${c.bgm_fade_in_sec ?? 1.5}`);
  lines.push(`bgm_fade_out_sec: ${c.bgm_fade_out_sec ?? 2.0}`);
  if (
    typeof c.pause_between_sentences_sec === "number" &&
    c.pause_between_sentences_sec > 0
  ) {
    lines.push(`pause_between_sentences_sec: ${c.pause_between_sentences_sec}`);
  }
  if (c.sfx && Object.keys(c.sfx).length > 0) {
    lines.push("sfx:");
    for (const [sceneId, tag] of Object.entries(c.sfx).sort()) {
      lines.push(`  ${sceneId}: ${JSON.stringify(tag)}`);
    }
  } else {
    lines.push("sfx: {}");
  }
  return lines.join("\n") + "\n";
}

export async function callAudioPlan(
  input: AudioPlanInput,
  provider: Provider,
  /** Optional fallback provider — when `provider` returns a quota /
   * rate-limit error, retry the request with `fallback` instead of
   * failing the run. */
  fallback?: Provider | null,
): Promise<CallAudioPlanResult> {
  const messages = buildMessages(input);
  const out = await chatWithFallback(provider, fallback ?? null, { messages });
  const res = out.response;
  const raw = res.content.trim();
  if (!raw) {
    throw new AudioPlanError("empty response from provider", out.provider);
  }
  const jsonText = unwrapJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    // Some LLM calls return YAML; try that.
    try {
      parsed = parseYaml(jsonText);
    } catch (err2) {
      throw new AudioPlanError(
        `JSON/YAML parse failed: ${(err as Error).message}`,
        provider.name,
        err,
      );
    }
  }
  // Merge with defaults so partial plans still produce a complete config.
  const merged: AudioConfig = { ...DEFAULT_AUDIO_CONFIG, ...(parsed as AudioConfig) };
  const validation = AudioConfigSchema.safeParse(merged);
  if (!validation.success) {
    throw new AudioPlanError(
      `audio-config invalid: ${validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      provider.name,
      validation.error,
    );
  }
  return {
    config: validation.data,
    yaml: renderAudioConfig(validation.data),
    usage: res.usage,
    providerName: out.provider,
  };
}

function unwrapJson(text: string): string {
  const fenced = /^```(?:json|yaml)?\s*\n?([\s\S]*?)\n?```\s*$/;
  const m = text.match(fenced);
  if (m && m[1] !== undefined) return m[1].trim();
  return text;
}
