import {
  appendLayaDecision,
  stateSha256,
  type LayaDecisionRecord,
} from "./laya-shadow.js";
import type { LayaAnswer, LayaClient, LayaMode, LayaQuestion } from "./laya.js";

/**
 * One decision consult, recorded — the loop every Laya surface shares.
 *
 * Before this module, each surface wrote its own copy of the same five
 * steps: build a state string, ask one question, validate the answer
 * against the allowed options, write a ~25-line sidecar row, and compute
 * `expected`/`agreed` against today's path. The copies drifted — the
 * `motion` surface inlined its instructions while the other two loaded
 * them from the prompt registry, and only the `visual` surface recorded
 * a question's real instructions in its row.
 *
 * This module owns that loop once. A surface now supplies:
 *
 *  - the STATE string (what the decision is about),
 *  - the QUESTION (type + instructions + criteria),
 *  - the BASELINE (what today's deterministic path would have answered),
 *
 * and gets back the answer plus the recorded row. The shadow-safety
 * invariants live here, not in each surface:
 *
 *  1. **Shadow never acts.** `acted` is true only in `on` mode AND only
 *     when an answer came back. A surface cannot accidentally act in
 *     shadow because it forgot a check.
 *  2. **Never throws.** A sidecar that is down, a malformed answer, a
 *     failed write — none of them may break the pipeline. The consult
 *     and the write are each independently guarded.
 *  3. **The row is honest.** `expected` and `agreed` are computed from
 *     the baseline the caller passed, so the §7 calibration analysis
 *     compares the decision against the path that actually ran.
 */

/** The baseline a surface would have produced without Laya. `null` means
 *  "no baseline for this call" — there is nothing to agree with, so the
 *  row carries no `expected`/`agreed` and the call does not count
 *  toward the §7 agreement rate. */
export type DecisionBaseline = string | number | boolean | null;

/** One question, plus the id it answers under. */
export interface DecisionQuestion {
  /** The question id — also the key in the sidecar row's `answers`. */
  id: string;
  type: LayaQuestion["type"];
  instructions: string;
  /** The allowed options (choice) or levels (score). */
  criteria?: string[] | undefined;
}

export interface RecordDecisionOptions {
  /** Which integration surface produced the row: motion | visual |
   *  triage | severity | … */
  surface: string;
  /** The state the decision is about. Hashed into the row; the raw
   *  string is NOT written, so a state containing sensitive content
   *  never lands on disk. */
  state: string;
  question: DecisionQuestion;
  /** The mode. `shadow` records but never acts; `off` does nothing at
   *  all; `on` records AND acts. */
  mode: LayaMode;
  /** What today's deterministic path would have answered. `null` = no
   *  baseline, so no agreement is computed. */
  baseline?: DecisionBaseline | undefined;
  /** Where to write the row. Undefined = don't record (the caller only
   *  wants the answer). */
  sidecarPath?: string | undefined;
  /** Called with the answer when the mode is `on` and an answer came
   *  back. This is the ONLY way a decision changes behavior. */
  onAnswer?: ((answer: LayaAnswer) => void) | undefined;
}

export interface RecordDecisionResult {
  /** The validated answer, or null when there was none (sidecar down,
   *  timeout, below min_confidence, or an answer outside `criteria`). */
  answer: LayaAnswer | null;
  /** The `value` of a choice answer, already checked against the
   *  allowed options. */
  choice: string | null;
  /** The `score` of a score answer. */
  score: number | null;
  /** The `noul` of a noul answer, as a boolean. */
  noul: boolean | null;
  /** The row as written — useful for tests and for a caller that wants
   *  to log it. Null when nothing was written (no sidecar path, or the
   *  write failed). */
  row: LayaDecisionRecord | null;
  /** How many provider calls this took (0 or 1). */
  asked: number;
}

/** Compare a decision against the baseline. Equality is the right
 *  relation for every question type the sidecar answers:
 *   - choice: the picked option must be the baseline option,
 *   - score:  the numeric value must be the baseline value,
 *   - noul:   the boolean must equal the baseline boolean.
 *
 *  A `score` surface whose baseline is a NUMBER compares numerically;
 *  one whose baseline is a STRING compares as text. Callers that want a
 *  tolerance (a score that is "close enough") pass a baseline that is
 *  already the agreed-upon answer — see `scoreWithin` for the numeric
 *  case. */
export function decisionsAgree(
  answer: LayaAnswer,
  baseline: DecisionBaseline,
): boolean {
  if (baseline === null) return false;
  const value = answer.value;
  if (value === undefined) return false;
  if (typeof baseline === "number") {
    const n = Number(value);
    return Number.isFinite(n) && n === baseline;
  }
  if (typeof baseline === "boolean") {
    return value === String(baseline);
  }
  return value === baseline;
}

/** Numeric agreement for a score question: |answer − baseline| ≤
 *  tolerance. A `score` decision rarely lands on exactly the baseline
 *  number, so string equality would report "disagreed" almost always.
 *  The tolerance is the caller's — the §7 gate owns the policy. */
export function scoreWithin(
  answer: LayaAnswer,
  baseline: number,
  tolerance: number,
): boolean {
  const n = Number(answer.value);
  return Number.isFinite(n) && Math.abs(n - baseline) <= tolerance;
}

/** Validate an answer against the question's type and criteria.
 *
 *  A `choice` answer must name one of the allowed options. A `score`
 *  answer must be a finite number. A `noul` answer must be a boolean.
 *  Anything else is "no usable answer" — the caller degrades to the
 *  baseline rather than acting on garbage. */
export function validateAnswer(
  answer: LayaAnswer | undefined,
  question: DecisionQuestion,
): LayaAnswer | null {
  if (answer === undefined) return null;
  const value = answer.value;
  if (value === undefined) return null;

  switch (question.type) {
    case "choice": {
      const allowed = question.criteria ?? [];
      if (allowed.length > 0 && !allowed.includes(value)) return null;
      return answer;
    }
    case "score": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return answer;
    }
    case "noul": {
      // The sidecar stringifies the boolean ("true" / "false").
      if (value !== "true" && value !== "false") return null;
      return answer;
    }
    default:
      return null;
  }
}

/**
 * Ask one question, validate the answer, and record the row.
 *
 * Never throws. Returns `answer: null` when the sidecar was down, timed
 * out, answered below the confidence floor, or answered outside the
 * question's criteria — and the caller falls back to its baseline.
 */
export async function recordDecision(
  client: LayaClient,
  opts: RecordDecisionOptions,
): Promise<RecordDecisionResult> {
  const empty: RecordDecisionResult = {
    answer: null,
    choice: null,
    score: null,
    noul: null,
    row: null,
    asked: 0,
  };

  if (opts.mode === "off") return empty;

  let decision: Awaited<ReturnType<LayaClient["decide"]>> = null;
  try {
    decision = await client.decide(opts.state, {
      [opts.question.id]: {
        type: opts.question.type,
        instructions: opts.question.instructions,
        ...(opts.question.criteria !== undefined
          ? { criteria: opts.question.criteria }
          : {}),
      },
    });
  } catch {
    // LayaClient.decide is contractually never-throwing; this is
    // defense-in-depth so a faulty client cannot break a pipeline.
    return empty;
  }
  if (decision === null) {
    // The sidecar was down, timed out, or answered below the
    // confidence floor. That is STILL a row worth recording: the
    // calibration corpus needs to see how often the decision layer was
    // unavailable, and a missing row is indistinguishable from a
    // surface that was never consulted.
    await writeRow(opts, null, null, opts.baseline);
    return empty;
  }

  const raw = decision.answers[opts.question.id];
  const answer = validateAnswer(raw, opts.question);
  if (answer === null) {
    // An unusable answer still gets RECORDED — the sidecar is the
    // calibration corpus, and "the sidecar answered, but the answer
    // was not usable" is exactly the signal §7 needs to see.
    await writeRow(opts, null, decision, null);
    return empty;
  }

  const baseline = opts.baseline ?? null;
  const agreed =
    baseline !== null && opts.mode === "shadow"
      ? decisionsAgree(answer, baseline)
      : undefined;

  await writeRow(opts, answer, decision, baseline, agreed);

  if (opts.mode === "on" && opts.onAnswer !== undefined) {
    try {
      opts.onAnswer(answer);
    } catch {
      // Acting on a decision must never break the pipeline either.
    }
  }

  return {
    answer,
    choice: answer.type === "choice" ? (answer.value ?? null) : null,
    score: answer.type === "score" ? Number(answer.value) : null,
    noul: answer.type === "noul" ? answer.value === "true" : null,
    row: null,
    asked: 1,
  };
}

export interface RecordLayaRowOptions {
  /** Where to write the row. */
  sidecarPath: string;
  /** Which integration surface produced the row. */
  surface: string;
  mode: LayaMode;
  /** The state the decision was about. Only its hash is written. */
  state: string;
  question: DecisionQuestion;
  /** The answer the consult already returned. Null = no usable answer. */
  answer: LayaAnswer | null;
  /** What today's deterministic path would have answered. */
  baseline?: DecisionBaseline | undefined;
}

/**
 * Record a row for an answer the caller ALREADY has.
 *
 * Some surfaces must consult before they can compute the baseline: the
 * motion surface asks whether the deterministic heuristics suffice, and
 * only the agent call that follows reveals whether they did. Those
 * surfaces consult once (via `recordDecision`) and then record the
 * result once (via this) — they must not ask the sidecar twice.
 *
 * Never throws.
 */
export async function recordLayaRow(opts: RecordLayaRowOptions): Promise<void> {
  const baseline = opts.baseline ?? null;
  const agreed =
    baseline !== null && opts.mode === "shadow" && opts.answer !== null
      ? decisionsAgree(opts.answer, baseline)
      : undefined;
  await writeRow(
    {
      surface: opts.surface,
      state: opts.state,
      question: opts.question,
      mode: opts.mode,
      baseline: opts.baseline,
      sidecarPath: opts.sidecarPath,
    },
    opts.answer,
    null,
    baseline,
    agreed,
  );
}

/** Write the sidecar row. Never throws — telemetry must not break a
 *  pipeline. */
async function writeRow(
  opts: RecordDecisionOptions,
  answer: LayaAnswer | null,
  decision: { latencyMs: number; routingModel: string } | null,
  baseline: DecisionBaseline | undefined,
  agreed?: boolean,
): Promise<void> {
  if (opts.sidecarPath === undefined) return;
  const question: LayaQuestion = {
    type: opts.question.type,
    instructions: opts.question.instructions,
    ...(opts.question.criteria !== undefined
      ? { criteria: opts.question.criteria }
      : {}),
  };
  try {
    await appendLayaDecision(opts.sidecarPath, {
      ts: new Date().toISOString(),
      surface: opts.surface,
      mode: opts.mode,
      state_sha256: stateSha256(opts.state),
      questions: { [opts.question.id]: question },
      answers: answer
        ? {
            [opts.question.id]: {
              type: answer.type,
              ...(answer.value !== undefined ? { value: answer.value } : {}),
              ...(answer.score !== undefined ? { score: answer.score } : {}),
              confidence: answer.confidence ?? 0,
              routingModel: answer.routingModel ?? "unknown",
            },
          }
        : null,
      routing_model: decision?.routingModel ?? null,
      latency_ms: decision?.latencyMs ?? null,
      // Shadow never acts. On mode acts only when an answer came back.
      acted: opts.mode === "on" && answer !== null,
      ...(baseline !== undefined && baseline !== null
        ? { expected: String(baseline) }
        : {}),
      ...(agreed !== undefined ? { agreed } : {}),
    });
  } catch {
    // Telemetry must never break the pipeline.
  }
}
