import {
  callStructured,
  extractFencedYaml,
  structuredYamlParser,
  type ChatMessage,
  type Provider,
  type Usage,
} from "@video/llm";
import { buildFallbackPackage, type FallbackInput } from "./fallback.js";
import { DouyinPackageSchema, type DouyinPackage } from "./schemas.js";
import { buildDouyinMessages, type DouyinInput } from "./prompt.js";

export class DouyinError extends Error {
  constructor(
    message: string,
    readonly providerName?: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DouyinError";
  }
}

/** Pull the YAML body out of a fenced block, or accept a bare document. */
export function extractYaml(content: string): string {
  return extractFencedYaml(content);
}

export interface CallDouyinResult {
  douyin: DouyinPackage;
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
 * Generate the Douyin package.
 *
 * Like `callBilibili` and unlike `callYouTube`, this NEVER throws for a
 * bad model response: a provider outage, a content filter, malformed YAML,
 * or a schema violation all degrade to `buildFallbackPackage`. A post is
 * worth more than a polished title — and Douyin is the platform where a
 * rejected post costs the most (the video has to be re-uploaded whole).
 */
export async function callDouyin(
  input: DouyinInput,
  provider: Provider,
  fallbackProvider?: Provider | null,
  coverReuse?: { youtubeCoverPrompt?: string | undefined },
): Promise<CallDouyinResult> {
  const messages = buildDouyinMessages(input);

  const degrade = (
    warning: string,
    providerName?: string,
  ): CallDouyinResult => {
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
      douyin: fb,
      source: "fallback",
      ...(providerName !== undefined ? { providerName } : {}),
      warning,
    };
  };

  try {
    const r = await callStructured<DouyinPackage>({
      messages,
      provider,
      fallback: fallbackProvider ?? null,
      parse: structuredYamlParser({
        schema: DouyinPackageSchema,
        schemaLabel: "Douyin package schema",
        toError: (message, providerName, cause) =>
          new DouyinError(message, providerName, cause),
      }),
    });
    return {
      douyin: r.data,
      source: "agent",
      providerName: r.providerName,
      usage: r.usage,
      messages: r.messages,
    };
  } catch (err) {
    // A provider outage, a content filter, malformed YAML, or a schema
    // violation — all degrade, never throw (the policy that shipped a
    // video when the model typoed).
    if (err instanceof DouyinError) {
      return degrade(err.message, err.providerName);
    }
    return degrade(`LLM call failed: ${(err as Error).message}`);
  }
}
