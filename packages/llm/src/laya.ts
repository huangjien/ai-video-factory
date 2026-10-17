import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

/**
 * Laya decision-model client (v0.6 plan §6, docs/v0.6-laya-decision-integration-plan.md).
 *
 * Laya (Convai Innovations, Apache-2.0) is a NON-autoregressive decision
 * model: bidirectional encoders returning bounded decisions — `choice` /
 * `score` / `noul` — with probabilities over a free-form state string.
 * It is NOT a chat model and must never be configured as a `Provider`:
 * it cannot generate the text the chat roles need.
 *
 * Wire protocol (laya-serve, measured 2026-10-14 against 127.0.0.1:8019):
 *   GET  /health         → {status, loaded, revisions, device, …}
 *   POST /v1/systemone   → {state, questions: {<qid>: {type, instructions,
 *                           criteria?}}} — `questions` is an OBJECT keyed by
 *                           id and the prompt field is `instructions`.
 *   Response: {answers: {<qid>: {type, choice|score|noul, probabilities,
 *             confidence, answer_confidence, action}}, usage, routing}.
 *
 * Contract: `decide()` NEVER throws and NEVER rejects. Any failure —
 * mode off, unhealthy, timeout, 503 twice, unparseable body — resolves
 * to `null`, and the caller runs today's code path unchanged (v0.6
 * plan §1 rule 2: degrade to current behavior).
 *
 * Confidence gating: we act on `answer_confidence` (the chosen answer's
 * own probability). The separate `confidence` field is the action-gate
 * signal and is UNCALIBRATED on the english checkpoint (upstream
 * temperature bug — a probe measured 0.0075 on a plausible answer), so
 * gating on it would drop every answer. `answer_confidence` gating +
 * the §7 shadow calibration check is the provisional policy until the
 * upstream fix lands.
 */

export type LayaMode = "off" | "shadow" | "on";

export interface LayaConfig {
  mode: LayaMode;
  url: string;
  /** Minimum `answer_confidence` for an answer to be returned at all. */
  minConfidence: number;
  /** Per-call HTTP budget. Warm CPU inference ≈ 0.5 s; first call after
   * service start can exceed 15 s, which is why callers pre-flight via
   * `health()` (20 s budget) and decide() uses the warm budget. */
  timeoutMs: number;
  bearer?: string | undefined;
}

export const LAYA_DEFAULTS: Readonly<LayaConfig> = {
  mode: "off",
  url: "http://127.0.0.1:8019",
  minConfidence: 0.6,
  timeoutMs: 3000,
};

export interface LayaQuestion {
  type: "choice" | "score" | "noul";
  instructions: string;
  /** choice options / score levels (wire: `criteria`). */
  criteria?: string[];
}

export interface LayaAnswer {
  type: "choice" | "score" | "noul";
  /** The chosen option (`choice`) or the noul boolean, stringified. */
  value?: string | undefined;
  score?: number | undefined;
  confidence: number;
  probabilities?: Record<string, number> | undefined;
  /** Which checkpoint answered: english | multilingual | typed-decisions. */
  routingModel: string;
}

export interface LayaDecision {
  answers: Record<string, LayaAnswer>;
  latencyMs: number;
  routingModel: string;
}

export interface LayaHealth {
  status: string;
  loaded: string[];
  revisions: Record<string, string>;
  device: string;
}

const LAYA_HEALTH_BUDGET_MS = 20_000;

/** `laya:` section from the llm.config.yaml file (same file
 * `loadProviderConfig` reads), then env overrides, then defaults. */
export function resolveLayaConfig(opts: { configPath?: string } = {}): LayaConfig {
  const cfg: LayaConfig = { ...LAYA_DEFAULTS, bearer: undefined };
  const path = opts.configPath ?? process.env["LL_CONFIG"];
  if (path && existsSync(path)) {
    try {
      const parsed = parseYaml(readFileSync(path, "utf8")) as {
        laya?: Partial<LayaConfig> | null;
      } | null;
      if (parsed && typeof parsed === "object" && parsed.laya) {
        Object.assign(cfg, parsed.laya);
      }
    } catch {
      // Malformed YAML must not take the pipeline down — keep defaults.
    }
  }
  const env = process.env;
  const mode = env["LAYA_MODE"];
  if (mode === "off" || mode === "shadow" || mode === "on") cfg.mode = mode;
  if (env["LAYA_URL"]) cfg.url = env["LAYA_URL"]!;
  if (env["LAYA_MIN_CONFIDENCE"]) {
    const n = Number.parseFloat(env["LAYA_MIN_CONFIDENCE"]!);
    if (Number.isFinite(n) && n >= 0 && n <= 1) cfg.minConfidence = n;
  }
  if (env["LAYA_TIMEOUT_MS"]) {
    const n = Number.parseInt(env["LAYA_TIMEOUT_MS"]!, 10);
    if (Number.isFinite(n) && n > 0) cfg.timeoutMs = n;
  }
  if (env["LAYA_BEARER"]) cfg.bearer = env["LAYA_BEARER"];
  return cfg;
}

export interface LayaClientOptions {
  config?: Partial<LayaConfig>;
  /** Test seam: bypass resolveLayaConfig (which reads env at call time). */
  resolvedConfig?: LayaConfig;
  fetchImpl?: typeof fetch;
}

export class LayaClient {
  private readonly cfg: LayaConfig;
  private readonly fetchImpl: typeof fetch;
  /** Memoized pre-flight result — one /health per process, unhealthy →
   * every decide() short-circuits. */
  private healthState: "unknown" | "ok" | "down" = "unknown";
  private lastHealth: LayaHealth | null = null;

  constructor(opts: LayaClientOptions = {}) {
    this.cfg = opts.resolvedConfig ?? {
      ...resolveLayaConfig(),
      ...opts.config,
    };
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  config(): LayaConfig {
    return this.cfg;
  }

  /** GET /health with the long cold-start budget. Memoized; `force`
   * re-probes (the `video laya health` verb wants live truth). */
  async health(force = false): Promise<LayaHealth | null> {
    if (!force && this.healthState !== "unknown") {
      return this.healthState === "ok" ? this.lastHealth : null;
    }
    try {
      const res = await this.fetchImpl(`${this.cfg.url}/health`, {
        signal: AbortSignal.timeout(LAYA_HEALTH_BUDGET_MS),
      });
      if (!res.ok) throw new Error(`health ${res.status}`);
      const parsed = (await res.json()) as LayaHealth;
      if (parsed?.status !== "ok") throw new Error("health not ok");
      this.healthState = "ok";
      this.lastHealth = parsed;
      return parsed;
    } catch {
      this.healthState = "down";
      this.lastHealth = null;
      return null;
    }
  }

  async healthy(): Promise<boolean> {
    return (await this.health()) !== null;
  }

  /** Ask one bounded-question set over one state. Resolves null on ANY
   * failure (off, down, timeout, 503×2, low confidence on every answer,
   * bad payload). 503 carries `Retry-After: 1` (single inference
   * worker); we honor it once, then give up — never queue the render
   * behind the sidecar. */
  async decide(
    state: string,
    questions: Record<string, LayaQuestion>,
  ): Promise<LayaDecision | null> {
    if (this.cfg.mode === "off") return null;
    if (Object.keys(questions).length === 0) return null;
    if (this.healthState === "down") return null;
    if (this.healthState === "unknown" && (await this.health()) === null) {
      return null;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.cfg.bearer) headers["Authorization"] = `Bearer ${this.cfg.bearer}`;

    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.url}/v1/systemone`, {
        method: "POST",
        headers,
        body: JSON.stringify({ state, questions }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      if (res.status === 503) {
        // Honor Retry-After once (server advertises 1s), then one retry.
        await new Promise((r) => setTimeout(r, 1000));
        res = await this.fetchImpl(`${this.cfg.url}/v1/systemone`, {
          method: "POST",
          headers,
          body: JSON.stringify({ state, questions }),
          signal: AbortSignal.timeout(this.cfg.timeoutMs),
        });
      }
    } catch {
      return null;
    }
    const latencyMs = Date.now() - started;
    if (!res.ok) return null;

    let parsed: SystemOneResponse;
    try {
      parsed = (await res.json()) as SystemOneResponse;
    } catch {
      return null;
    }
    const routingModel = parsed.routing?.model ?? "unknown";
    // The min_confidence gate protects ACTING (mode=on). In shadow the
    // answers must be recorded RAW — otherwise the §7 calibration
    // analysis would only ever see pre-filtered data. Surfaces never
    // act in shadow by construction (v0.6 plan §1).
    const minConfidence =
      this.cfg.mode === "shadow" ? 0 : this.cfg.minConfidence;
    const answers: Record<string, LayaAnswer> = {};
    for (const [qid, raw] of Object.entries(parsed.answers ?? {})) {
      const confidence = raw.answer_confidence ?? raw.confidence ?? 0;
      if (confidence < minConfidence) continue;
      const answer: LayaAnswer = {
        type: raw.type,
        confidence,
        routingModel,
      };
      if (typeof raw.choice === "string") answer.value = raw.choice;
      if (typeof raw.score === "number") {
        answer.score = raw.score;
        answer.value = String(raw.score);
      }
      if (raw.noul !== undefined) answer.value = String(raw.noul);
      if (raw.probabilities) answer.probabilities = raw.probabilities;
      answers[qid] = answer;
    }
    return { answers, latencyMs, routingModel };
  }
}

interface SystemOneResponse {
  answers?: Record<
    string,
    {
      type: "choice" | "score" | "noul";
      choice?: string;
      score?: number;
      noul?: boolean;
      probabilities?: Record<string, number>;
      confidence?: number;
      answer_confidence?: number;
    }
  >;
  usage?: { input_tokens?: number; output_tokens?: number };
  routing?: { model?: string };
}
