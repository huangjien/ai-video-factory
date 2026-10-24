import {
  chatWithFallback,
  extractFencedYaml,
  parseStructuredYaml,
  type ChatMessage,
  type Provider,
  type Usage,
} from "@video/llm";
import { buildFallbackPackage, type FallbackInput } from "./fallback.js";
import { BilibiliPackageSchema, type BilibiliPackage } from "./schemas.js";
import { buildBilibiliMessages, type BilibiliInput } from "./prompt.js";

export class BilibiliError extends Error {
  constructor(
    message: string,
    readonly providerName?: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BilibiliError";
  }
}

/** Pull the YAML body out of a fenced block, or accept a bare document. */
export function extractYaml(content: string): string {
  return extractFencedYaml(content);
}

export interface CallBilibiliResult {
  bilibili: BilibiliPackage;
  /** Which path produced the package. `fallback` is a degraded but valid
   * package built from the article with no model involved. */
  source: "agent" | "fallback";
  providerName?: string;
  usage?: Usage | undefined;
  /** Human-readable reason the agent path was abandoned, when it was. */
  warning?: string | undefined;
  messages?: ChatMessage[] | undefined;
}

/**
 * Generate the Bilibili package.
 *
 * Unlike `callYouTube`, this NEVER throws for a bad model response: a
 * provider outage, a content filter, malformed YAML, or a schema violation
 * all degrade to `buildFallbackPackage`. The YouTube agent hard-fails on
 * exactly these, which is why packaging it by hand was the only way to ship
 * a video this week. A submission is worth more than a polished title.
 */
export async function callBilibili(
  input: BilibiliInput,
  provider: Provider,
  fallbackProvider?: Provider | null,
  coverReuse?: { youtubeCoverPrompt?: string | undefined },
): Promise<CallBilibiliResult> {
  const messages = buildBilibiliMessages(input);

  const degrade = (
    warning: string,
    providerName?: string,
  ): CallBilibiliResult => {
    const fb = buildFallbackPackage({
      article: input.article,
      ...(input.imageStyle !== undefined
        ? { imageStyle: input.imageStyle }
        : {}),
      ...(coverReuse?.youtubeCoverPrompt !== undefined
        ? { youtubeCoverPrompt: coverReuse.youtubeCoverPrompt }
        : {}),
    });
    return {
      bilibili: fb,
      source: "fallback",
      ...(providerName !== undefined ? { providerName } : {}),
      warning,
    };
  };

  let out;
  try {
    out = await chatWithFallback(provider, fallbackProvider ?? null, {
      messages,
    });
  } catch (err) {
    return degrade(`LLM call failed: ${(err as Error).message}`);
  }

  try {
    const bilibili = parseStructuredYaml(out.response.content, out.provider, {
      schema: BilibiliPackageSchema,
      schemaLabel: "Bilibili package schema",
      toError: (message, providerName, cause) =>
        new BilibiliError(message, providerName, cause),
    });
    return {
      bilibili,
      source: "agent",
      providerName: out.provider,
      usage: out.response.usage,
      messages,
    };
  } catch (err) {
    // no YAML / YAML parse failure / schema violation — all degrade, never
    // throw (the policy that shipped a video when the model typoed).
    return degrade((err as Error).message, out.provider);
  }
}
