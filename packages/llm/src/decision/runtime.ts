/**
 * The decision layer's runtime — mode, provider choice, quota visibility,
 * log location. It lives in @video/llm (not in @video/draft) because more
 * than one domain package wires a decision surface: the draft loop owns
 * visual-class and draft-bar, the QA command owns qa-triage — and a
 * lower-level package must not depend on a higher one for its own
 * runtime.
 */
import { MiniMaxDecisionProvider } from "./minimax.js";
import { OpenAIDecisionProvider } from "./openai.js";
import { GoogleDecisionProvider } from "./google.js";
import { decideManyWithProvider, providerSupportsInput } from "./contract.js";
import { validateDecisionBatch } from "./contract.js";
import type {
  DecisionAnswer,
  DecisionBatchRequest,
  DecisionBatchResult,
  DecisionInputModality,
  DecisionProvider,
  DecisionRequest,
} from "./contract.js";

export type DecisionMode = "off" | "shadow" | "on";

/** The mode from the environment. Default **`off`** (2026-11-26): the
 *  layer records the decision provider's answers beside the baselines
 *  and nothing acts on them, so every consult was a paid call that
 *  bought a log line. `on` and `shadow` behave identically today — both
 *  record, nothing acts — and the env var is how the layer is switched
 *  back on (or off) without a code change. The vitest global setup
 *  pins `off` so the suite stays hermetic. */
export function resolveDecisionMode(
  env: NodeJS.ProcessEnv = process.env,
): DecisionMode {
  const raw = (env["DECISION_MODE"] ?? "off").trim().toLowerCase();
  if (raw === "off" || raw === "shadow" || raw === "on") return raw;
  throw new Error(
    `unknown DECISION_MODE "${raw}" — expected off | shadow | on`,
  );
}

export interface CreateDecisionProviderOptions {
  /** `auto` (default) = the fallback chain; provider ids select one
   *  provider alone. */
  provider?: string | undefined;
  /** Override the PRIMARY provider's model. */
  model?: string | undefined;
  /** Override the FALLBACK provider's model (chain only). */
  fallbackModel?: string | undefined;
}

/**
 * An ordered chain of providers: the first that can serve answers.
 *
 * The layer consults a provider on every draft, so provider AVAILABILITY
 * is a production concern, not an edge case — MiniMax's monthly plan ran
 * out mid-measurement (2026-11-15) and OpenAI's plan can too. The chain
 * turns "the whole layer went quiet" into "the second provider answered".
 *
 * Two rules keep the chain honest:
 *
 *  1. **Fall through only on an availability failure** — an error, a
 *     timeout, an exhausted quota. A provider that ANSWERED but whose
 *     answer was unusable is a quality signal; falling back there would
 *     hide it behind a better-looking answer and spend a second call.
 *     (Both providers set `lastError` whenever they return null, so in
 *     practice a null answer IS an availability failure.)
 *  2. **The answer names the provider that served it.** Every log row
 *     records the SERVING provider, so a fallback run is visible in the
 *     corpus instead of being averaged into the primary's score.
 */
export class FallbackDecisionProvider implements DecisionProvider {
  readonly name: string;
  readonly supportedModalities: readonly DecisionInputModality[];
  /** The last failure from the chain — the reason the answer is null. */
  lastError: Error | null = null;
  private readonly providers: DecisionProvider[];

  constructor(providers: DecisionProvider[]) {
    if (providers.length === 0) {
      throw new Error("FallbackDecisionProvider needs at least one provider");
    }
    this.providers = providers;
    this.name =
      providers.length === 1
        ? providers[0]!.name
        : providers.map((p) => p.name).join("→");
    this.supportedModalities = [
      ...new Set<DecisionInputModality>(
        providers.flatMap(
          (provider) => provider.supportedModalities ?? (["text"] as const),
        ),
      ),
    ];
  }

  /** The providers, in the order they are tried. */
  get chain(): readonly DecisionProvider[] {
    return this.providers;
  }

  available(): boolean {
    return this.providers.some((p) => p.available());
  }

  async decide(req: DecisionRequest): Promise<DecisionAnswer | null> {
    this.lastError = null;
    for (const provider of this.providers) {
      // A provider without a key cannot serve — skip it without a call.
      if (!provider.available()) continue;
      const answer = await provider.decide(req);
      if (answer !== null) {
        this.lastError = provider.lastError;
        return answer;
      }
      // No error recorded → the provider answered with something
      // unusable. That is a quality signal, not an outage: stop here.
      if (provider.lastError === null) return null;
      this.lastError = provider.lastError;
    }
    return null;
  }

  async decideMany(req: DecisionBatchRequest): Promise<DecisionBatchResult> {
    this.lastError = null;
    try {
      validateDecisionBatch(req);
    } catch (err) {
      const message = (err as Error).message;
      return {
        answers: req.questions.map(({ question }) => ({
          questionId: question.id,
          answer: null,
          error: message,
        })),
        provider: this.name,
        model: "",
        usage: { input: 0, output: 0 },
        latencyMs: 0,
      };
    }
    for (const provider of this.providers) {
      if (!provider.available()) continue;
      if (!providerSupportsInput(provider, req.input)) {
        continue;
      }
      const result = await decideManyWithProvider(provider, req);
      if (provider.lastError !== null) {
        this.lastError = provider.lastError;
        continue;
      }
      if (result.answers.some((item) => item.answer !== null)) {
        this.lastError = provider.lastError;
        return result;
      }
      return result;
    }
    return {
      answers: req.questions.map(({ question }) => ({
        questionId: question.id,
        answer: null,
        error:
          this.lastError?.message ??
          "no compatible decision provider available",
      })),
      provider: this.name,
      model: "",
      usage: { input: 0, output: 0 },
      latencyMs: 0,
    };
  }
}

/** The provider the layer consults.
 *
 *  Default: Gemini Decisions first, then text-compatible OpenAI and
 *  MiniMax fallbacks. `DECISION_PROVIDER` pins one provider.
 */
export function createDecisionProvider(
  opts: CreateDecisionProviderOptions = {},
): DecisionProvider {
  const name = (opts.provider ?? "auto").trim().toLowerCase();
  if (name === "openai") {
    return new OpenAIDecisionProvider(
      opts.model !== undefined ? { model: opts.model } : {},
    );
  }
  if (name === "minimax") {
    return new MiniMaxDecisionProvider(
      opts.model !== undefined ? { model: opts.model } : {},
    );
  }
  if (name === "google") {
    return new GoogleDecisionProvider(
      opts.model !== undefined ? { model: opts.model } : {},
    );
  }
  if (name === "auto") {
    return new FallbackDecisionProvider([
      new GoogleDecisionProvider(
        opts.model !== undefined ? { model: opts.model } : {},
      ),
      new OpenAIDecisionProvider({}),
      new MiniMaxDecisionProvider(
        opts.fallbackModel !== undefined ? { model: opts.fallbackModel } : {},
      ),
    ]);
  }
  throw new Error(
    `unknown decision provider "${name}" — auto | openai | minimax | google`,
  );
}

/** True for an error that means "the provider's quota/rate limit is
 *  exhausted" — as opposed to a one-off timeout or a malformed answer.
 *  MiniMax's monthly plan returns 429 with error 2056 when the month's
 *  budget is spent; the layer degrades either way, but the operator
 *  should know WHICH degradation they are looking at. */
export function isQuotaError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /429|rate.?limit|usage limit|quota|resource_exhausted/i.test(message);
}

/** Print one stderr line when consults hit the provider's quota. The
 *  layer keeps running (the deterministic path never needed the
 *  provider), but a silent stop of the shadow log looks like a bug —
 *  this says what it is. */
export function warnIfQuotaExhausted(
  errors: (string | null | undefined)[],
): void {
  if (errors.some((e) => isQuotaError(e))) {
    console.error(
      "  ! decision provider quota/rate limit exhausted — the shadow pass degraded to the deterministic path for the affected calls",
    );
  }
}

/** Where a project's decision log lives. Every surface appends to the
 *  same file and tells each other apart by the `surface` field. */
export function decisionLogPath(projectRoot: string): string {
  return `${projectRoot}/decision-log.jsonl`;
}
