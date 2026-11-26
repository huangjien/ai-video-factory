#!/usr/bin/env node
/**
 * Experiment — can the draft-bar verdict be CALIBRATED rather than
 * replaced?
 *
 * The measurement (docs/v0.11-decision-provider-plan.md §7.7) found the
 * decision model answers one notch STRICTER than the review's verdict:
 * 108 of 174 real consults said "reject" where the review said "revise".
 * The question is whether that is a wording problem (fixable) or a
 * capability problem (not).
 *
 * The method:
 *   - four wordings of the same question (the production one and three
 *     alternatives), each registered in the prompt registry;
 *   - every wording is asked the same 176 real corpus cases;
 *   - the answers are scored two ways: RAW (does the answer match the
 *     artifact's verdict?) and CALIBRATED (does it match after a
 *     monotone one-notch shift fitted on a TRAIN half and measured on a
 *     held-out TEST half?).
 *
 * The train/test split is the point: a shift fitted and measured on the
 * same cases would fit noise. Only the test number means anything.
 *
 *   node scripts/experiment-decision-question.mjs [--cases N] [--provider openai]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const { listDecisionCases, loadDecisionQuestion, DECISION_QUESTIONS } =
  await import(path.join(repoRoot, "packages/prompts/dist/index.js"));
const { OpenAIDecisionProvider, MiniMaxDecisionProvider } = await import(
  path.join(repoRoot, "packages/llm/dist/index.js")
);

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const providerName = argOf("provider", "openai");
const maxCases = Number(argOf("cases", "0"));

const VARIANTS = [
  { id: "draft-bar", label: "v1 production" },
  { id: "draft-bar-v2", label: "v2 editorial volume" },
  { id: "draft-bar-v3", label: "v3 severity-anchored" },
  { id: "draft-bar-v4", label: "v4 editorial outcome" },
];

/** The monotone shifts under test: map the model's answer onto the
 *  review's scale. */
const SHIFTS = {
  none: (a) => a,
  "reject→revise": (a) => (a === "reject" ? "revise" : a),
  "reject→revise, revise→pass": (a) =>
    a === "reject" ? "revise" : a === "revise" ? "pass" : a,
  "reject→pass": (a) => (a === "reject" ? "pass" : a),
};

const cases = listDecisionCases({ surface: "draft-bar" })
  .map((ref) => ({
    id: ref.fixture.id,
    state: ref.fixture.state,
    label: String(ref.fixture.expects.value),
  }))
  .sort((a, b) => a.id.localeCompare(b.id));
const selected = maxCases > 0 ? cases.slice(0, maxCases) : cases;
const split = Math.floor(selected.length / 2);
const train = selected.slice(0, split);
const test = selected.slice(split);

function makeProvider() {
  return providerName === "minimax"
    ? new MiniMaxDecisionProvider({ model: "MiniMax-M3.1-Flash" })
    : new OpenAIDecisionProvider({ model: "gpt-6-luna" });
}

const accuracy = (answers) => {
  if (answers.length === 0) return 0;
  const hits = answers.filter((a) => a.answer === a.label).length;
  return hits / answers.length;
};

const results = [];
const variantAnswers = [];
for (const variant of VARIANTS) {
  const spec = DECISION_QUESTIONS[variant.id];
  const provider = makeProvider();
  const answers = [];
  for (const c of selected) {
    const answer = await provider.decide({
      state: c.state,
      question: {
        id: `draft-bar:${c.id}`,
        kind: "choice",
        instructions: loadDecisionQuestion(variant.id),
        options: spec.options,
        resultProperty: spec.resultProperty,
      },
    });
    answers.push({
      id: c.id,
      label: c.label,
      answer: answer?.value.kind === "choice" ? answer.value.option : null,
      confidence: answer?.confidence ?? null,
    });
  }
  const trainAnswers = answers.slice(0, train.length);
  const testAnswers = answers.slice(train.length);
  // Fit the shift on TRAIN only, then score it on TEST.
  const fitted = Object.entries(SHIFTS)
    .map(([name, fn]) => ({
      name,
      fn,
      train: accuracy(
        trainAnswers.map((a) => ({
          ...a,
          answer: a.answer ? fn(a.answer) : null,
        })),
      ),
    }))
    .sort((a, b) => b.train - a.train)[0];
  variantAnswers.push(answers);
  results.push({
    variant: variant.label,
    raw: accuracy(answers),
    rawTrain: accuracy(trainAnswers),
    rawTest: accuracy(testAnswers),
    shift: fitted.name,
    calibratedTest: accuracy(
      testAnswers.map((a) => ({
        ...a,
        answer: a.answer ? fitted.fn(a.answer) : null,
      })),
    ),
    matrix: countMatrix(answers),
    answered: answers.filter((a) => a.answer !== null).length,
  });
  console.log(
    `${variant.label.padEnd(22)} raw ${(results[results.length - 1].raw * 100).toFixed(1)}%  ` +
      `train ${(results[results.length - 1].rawTrain * 100).toFixed(1)}%  ` +
      `test ${(results[results.length - 1].rawTest * 100).toFixed(1)}%  ` +
      `| best shift on train: ${fitted.name} → test ${(results[results.length - 1].calibratedTest * 100).toFixed(1)}%`,
  );
}

function countMatrix(answers) {
  const counts = new Map();
  for (const a of answers) {
    const key = `${a.answer ?? "null"}→${a.label}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// The per-case answers, so the screen's precision and the
// stop-polishing risk can be measured without re-running the calls.
const { writeFileSync } = await import("node:fs");
writeFileSync(
  path.join(repoRoot, "runs", "decision-question-experiment.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      provider: providerName,
      cases: selected.map((c) => c.id),
      train: train.length,
      variants: results.map((r, i) => ({
        variant: r.variant,
        answers: variantAnswers[i],
      })),
    },
    null,
    2,
  ),
);

console.log(
  `\ncases: ${selected.length} (train ${train.length} / test ${test.length}) · provider: ${providerName}`,
);
for (const r of results) {
  console.log(`\n${r.variant} — answered ${r.answered}/${selected.length}`);
  console.log(`  ${r.matrix.map(([k, n]) => `${k}:${n}`).join("  ")}`);
}
