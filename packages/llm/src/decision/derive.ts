import {
  clampProbability,
  type DecisionQuestion,
  type DecisionValue,
} from "./contract.js";

/**
 * Build the typed value from a probability distribution over the
 * question's own vocabulary.
 *
 * The keys are the option names (a `choice`), the level labels (a
 * `score`), or `"true"` / `"false"` (a `noul`). Every provider that
 * returns a distribution — OpenAI's Decisions API, MiniMax's vote
 * mode — hands it back in that shape, so the conversion lives here once.
 *
 * - `choice` → the highest-probability option.
 * - `score` → the probability-weighted average of the level positions,
 *   so a soft answer lands between two levels.
 * - `noul` → the probability that the statement is true.
 */
export function deriveValueFromDistribution(
  question: DecisionQuestion,
  probabilities: Record<string, number>,
): DecisionValue | null {
  if (question.kind === "choice") {
    const options = question.options ?? [];
    let winner: string | null = null;
    let best = -1;
    let total = 0;
    for (const option of options) {
      const p = clampProbability(probabilities[option] ?? 0);
      total += p;
      if (p > best) {
        best = p;
        winner = option;
      }
    }
    // No mass on any offered option means the answer named something
    // else — a null, not a guess.
    if (winner === null || total <= 0) return null;
    const named: Record<string, number> = {};
    for (const option of options) {
      named[option] = clampProbability(probabilities[option] ?? 0);
    }
    return { kind: "choice", option: winner, probabilities: named };
  }
  if (question.kind === "score") {
    const levels = question.levels ?? [];
    let weighted = 0;
    let total = 0;
    const named: Record<string, number> = {};
    const legend: Record<string, string> = {};
    levels.forEach((label, index) => {
      const p = clampProbability(probabilities[label] ?? 0);
      named[label] = p;
      legend[String(index)] = label;
      weighted += p * index;
      total += p;
    });
    if (total <= 0) return null;
    return {
      kind: "score",
      score: weighted / total,
      probabilities: named,
      legend,
    };
  }
  const yes = clampProbability(probabilities["true"] ?? 0);
  const no = clampProbability(probabilities["false"] ?? 0);
  if (yes + no <= 0) return null;
  return { kind: "noul", probability: yes / (yes + no) };
}

/** The key with the highest probability, or null when the map is empty. */
export function winnerKey(
  probabilities: Record<string, number>,
): string | null {
  let winner: string | null = null;
  let best = -Infinity;
  for (const [key, p] of Object.entries(probabilities)) {
    if (p > best) {
      best = p;
      winner = key;
    }
  }
  return winner;
}
