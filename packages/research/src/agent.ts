import type { Provider } from "@vf/llm";
import { parse as parseYaml } from "yaml";
import { buildMessages, type ResearchInput } from "./prompt.js";
import {
  ResearchOutputSchema,
  type ResearchOutput,
  type WebSearchResult,
} from "./schemas.js";

export class ResearchError extends Error {
  override readonly cause: unknown;
  constructor(message: string, public readonly providerName: string, cause?: unknown) {
    super(message);
    this.name = "ResearchError";
    this.cause = cause;
  }
}

export interface WebSearchTool {
  search(query: string): Promise<WebSearchResult[]>;
}

export interface CallResearchDeps {
  web: WebSearchTool | null;
  /** When set, used as the query sent to web search. Otherwise derived from topic. */
  webQuery?: string | undefined;
}

export interface CallResearchResult {
  output: ResearchOutput;
  usage: { input: number; output: number };
}

/** Extract the first YAML code block from the LLM response and parse it. */
export function extractYaml(content: string): string {
  const fence = /```(?:yaml)?\s*([\s\S]*?)```/m;
  const match = content.match(fence);
  if (match && match[1]) return match[1].trim();
  return content.trim();
}

export async function callResearch(
  input: ResearchInput,
  provider: Provider,
  deps: CallResearchDeps,
): Promise<CallResearchResult> {
  let webContext: WebSearchResult[] | undefined;
  let webSearchUsed = false;
  let webSearchFailed = false;
  if (deps.web) {
    try {
      webContext = await deps.web.search(deps.webQuery ?? input.topic);
      webSearchUsed = true;
  } catch {
    webSearchFailed = true;
  }
  }
  const messages = buildMessages({
    ...input,
    ...(webContext && webContext.length > 0 ? { webContext } : {}),
  });
  const res = await provider.chat({ messages });
  const yamlText = extractYaml(res.content);
  if (!yamlText) {
    throw new ResearchError("no YAML in response", provider.name);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    throw new ResearchError(
      `YAML parse failed: ${(err as Error).message}`,
      provider.name,
      err,
    );
  }
  const result = ResearchOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new ResearchError(
      `Research output schema invalid: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      provider.name,
      result.error,
    );
  }
  // Cross-validate: every claim.sources[i] must exist in output.sources
  const sourceIds = new Set(result.data.sources.map((s) => s.id));
  for (const claim of result.data.claims) {
    for (const sid of claim.sources as string[]) {
      if (!sourceIds.has(sid)) {
        throw new ResearchError(
          `unknown source id ${sid} in claim ${claim.id}`,
          provider.name,
        );
      }
    }
  }
  // Stamp meta with provider/model
  const output: ResearchOutput = {
    ...result.data,
    meta: {
      ...result.data.meta,
      web_search_used: webSearchUsed,
      web_search_failed: webSearchFailed,
      provider: provider.name,
      model: result.data.meta.provider,
    },
  };
  return { output, usage: res.usage };
}
