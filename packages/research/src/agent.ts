import type { ChatMessage, Provider } from "@video/llm";
import { callStructuredAgent } from "@video/llm";
import { buildMessages, type ResearchInput } from "./prompt.js";
import {
  ResearchOutputSchema,
  type ResearchOutput,
  type WebSearchResult,
} from "./schemas.js";

export class ResearchError extends Error {
  override readonly cause: unknown;
  constructor(
    message: string,
    public readonly providerName: string,
    cause?: unknown,
  ) {
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
  /** Name of the provider that actually served the request
   * (primary or its fallback, per `chatWithFallback`). */
  providerName: string;
  /** The exact messages sent to the provider — lets callers hash the
   * real prompt for run-record `prompt_hash`. */
  messages: ChatMessage[];
}

export async function callResearch(
  input: ResearchInput,
  provider: Provider,
  deps: CallResearchDeps,
  /** Optional fallback provider — when `provider` returns a quota /
   * rate-limit error, retry the request with `fallback` instead of
   * failing the run. */
  fallback?: Provider | null,
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
  const r = await callStructuredAgent({
    messages: buildMessages({
      ...input,
      ...(webContext && webContext.length > 0 ? { webContext } : {}),
    }),
    provider,
    fallback: fallback ?? null,
    schema: ResearchOutputSchema,
    schemaLabel: "Research output schema",
    toError: (message, providerName, cause) =>
      new ResearchError(message, providerName, cause),
  });
  // Cross-validate: every claim.sources[i] must exist in output.sources
  const sourceIds = new Set(r.data.sources.map((s) => s.id));
  for (const claim of r.data.claims) {
    for (const sid of claim.sources as string[]) {
      if (!sourceIds.has(sid)) {
        throw new ResearchError(
          `unknown source id ${sid} in claim ${claim.id}`,
          r.providerName,
        );
      }
    }
  }
  // Stamp meta with provider/model
  const output: ResearchOutput = {
    ...r.data,
    meta: {
      ...r.data.meta,
      web_search_used: webSearchUsed,
      web_search_failed: webSearchFailed,
      provider: r.providerName,
      model: r.data.meta.model,
    },
  };
  return {
    output,
    usage: r.usage,
    providerName: r.providerName,
    messages: r.messages,
  };
}
