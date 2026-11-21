/**
 * The rubric-score decision surface — the eval harness's judge, read
 * through the Decisions API.
 *
 * The prompt-eval harness scores an agent's output on rubric axes
 * (0–10) with a chat judge that answers in JSON. The number it returns
 * carries no confidence: a judge that answered 6 because it read the
 * output carefully and a judge that answered 6 because it had no idea
 * look identical in the report.
 *
 * The Decisions API's `score` question returns the level distribution
 * behind the answer, so an axis gets a calibrated score AND a
 * confidence. This surface does not replace the chat judge — the
 * recorded baselines depend on it — it MEASURES beside it: the two
 * scores are printed together, so a rubric axis that the chat judge is
 * unsure about is visible instead of silently averaged in.
 */
import {
  consultDecisionMany,
  createDecisionProvider,
  resolveDecisionMode,
  type DecisionMode,
  type DecisionProvider,
  type DecisionQuestion,
} from "@video/llm";

/** The rubric levels an axis is scored on: 0 through 10. */
export const RUBRIC_LEVELS: string[] = Array.from({ length: 11 }, (_, i) =>
  String(i),
);

/** The question one rubric axis is asked. */
export function rubricScoreQuestion(
  agent: string,
  axis: string,
): DecisionQuestion {
  return {
    id: `eval-rubric:${agent}:${axis}`,
    kind: "score",
    instructions: [
      `Rate the output of the "${agent}" agent on the "${axis}" axis, from 0 to 10.`,
      "0 is the worst possible result on this axis and 10 is the best.",
      "Answer with the level the output deserves.",
    ].join(" "),
    levels: RUBRIC_LEVELS,
    resultProperty: "score",
  };
}

/** One axis' decision answer. */
export interface RubricDecisionScore {
  axis: string;
  /** The probability-weighted score, 0–10. Null when there was no
   *  answer. */
  score: number | null;
  confidence: number | null;
  provider: string;
  model: string;
  error: string | null;
}

/**
 * Ask the decision model for every axis' score.
 *
 * A provider that fails does not fail the case: the axis carries the
 * error and the chat judge's score stands alone. The eval harness is a
 * developer tool, and a decision outage must not take the report with
 * it.
 */
export async function decisionRubricScores(opts: {
  agent: string;
  axes: string[];
  output: string;
  provider: DecisionProvider;
}): Promise<RubricDecisionScore[]> {
  if (opts.axes.length === 0) return [];
  const questions = opts.axes.map((axis) => ({
    question: rubricScoreQuestion(opts.agent, axis),
  }));
  const result = await consultDecisionMany({
    provider: opts.provider,
    request: {
      input: [{ type: "text", text: opts.output.slice(0, 12_000) }],
      questions,
    },
  });
  const byId = new Map(
    result.answers.map((answer) => [answer.questionId, answer]),
  );
  return opts.axes.map((axis) => {
    const answer = byId.get(`eval-rubric:${opts.agent}:${axis}`);
    const score =
      answer?.value !== null && answer?.value?.kind === "score"
        ? answer.value.score
        : null;
    return {
      axis,
      score,
      confidence: answer?.confidence ?? null,
      provider: result.provider,
      model: result.model,
      error: answer?.error ?? null,
    };
  });
}

/** The decision provider the harness uses, or null when the layer is
 *  off or no provider is available. */
export function rubricDecisionProvider(
  env: NodeJS.ProcessEnv = process.env,
): DecisionProvider | null {
  const mode = resolveDecisionMode(env);
  if (mode === "off") return null;
  const provider = createDecisionProvider({
    ...(env["DECISION_PROVIDER"] !== undefined
      ? { provider: env["DECISION_PROVIDER"] }
      : {}),
    ...(env["DECISION_MODEL"] !== undefined
      ? { model: env["DECISION_MODEL"] }
      : {}),
  });
  return provider.available() ? provider : null;
}

export type { DecisionMode };
