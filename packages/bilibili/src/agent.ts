import { chatWithFallback, type ChatMessage, type Provider, type Usage } from "@video/llm";
import { parse as parseYaml } from "yaml";
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
  const fence = /```(?:yaml)?\s*([\s\S]*?)```/m;
  const match = content.match(fence);
  if (match && match[1]) return match[1].trim();
  return content.trim();
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
      ...(input.imageStyle !== undefined ? { imageStyle: input.imageStyle } : {}),
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
    out = await chatWithFallback(provider, fallbackProvider ?? null, { messages });
  } catch (err) {
    return degrade(`LLM call failed: ${(err as Error).message}`);
  }

  const providerName = out.provider;
  const yamlText = extractYaml(out.response.content);
  if (!yamlText) {
    return degrade("model returned no YAML", providerName);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    return degrade(
      `YAML parse failed: ${(err as Error).message}`,
      providerName,
    );
  }

  const result = BilibiliPackageSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return degrade(`schema invalid — ${detail}`, providerName);
  }

  return {
    bilibili: result.data,
    source: "agent",
    providerName,
    usage: out.response.usage,
    messages,
  };
}
