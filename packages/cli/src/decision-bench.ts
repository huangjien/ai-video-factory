/**
 * `video decision bench` — measure the decision providers against the
 * corpus.
 *
 * The question this answers is not "does the provider work" (the unit
 * tests answer that) but "which provider should the pipeline use": the
 * one that is accurate enough, cheap enough and fast enough, measured
 * on THIS pipeline's cases.
 *
 * The ranking is deterministic code, never a model's opinion:
 *
 *  1. A provider is ELIGIBLE only if its accuracy clears
 *     `--min-accuracy`, clears the accuracy of today's deterministic
 *     path on the same cases, and — when the corpus carries `noul`
 *     cases — its Brier score clears `--max-brier`.
 *  2. Eligible providers rank by cost per decision, then by p95
 *     latency.
 *  3. Every axis prints whether or not it decided the ranking, so a
 *     provider that wins on price and loses on accuracy stays visible.
 *
 * A missing price prints `n/a`, never `0`: the repo already shipped one
 * fabricated `usage 0/0` bug, and a zero price would make a provider
 * look free.
 */
import type { Command } from "commander";
import {
  DECISION_QUESTIONS,
  isRetiredSurface,
  listDecisionCases,
  loadDecisionPrices,
  loadDecisionQuestion,
  type DecisionCaseRef,
  type DecisionSurface,
} from "@video/prompts";
import {
  registerDecisionBackfill,
  registerDecisionHarvest,
} from "./decision-harvest.js";
import {
  MiniMaxDecisionProvider,
  OpenAIDecisionProvider,
  type DecisionAnswer,
  type DecisionProvider,
  type DecisionQuestion,
  type DecisionRequest,
  type DecisionValue,
} from "@video/llm";

export interface BenchProviderSpec {
  /** The provider id — the key the price table is filed under. */
  id: string;
  label: string;
  model: string;
  make: () => DecisionProvider;
}

/** One provider's answer to one case. */
export interface CaseResult {
  case: string;
  surface: DecisionSurface;
  /** True when the case's label is arguable (the corpus says so). */
  disputed: boolean;
  /** null when the provider returned no usable answer. */
  got: string | number | boolean | null;
  expected: string | number | boolean;
  /** null when the provider returned no usable answer. */
  correct: boolean | null;
  /** The provider's confidence on the aggregated answer. */
  confidence: number | null;
  confidenceSource: string | null;
  /** Whether the aggregated probability falls inside the case's band. */
  inBand: boolean | null;
  /** Every call this case made. */
  calls: number;
  latencyMs: number;
  usage: { input: number; output: number };
  error: string | null;
}

/** One surface's numbers. The corpus is lopsided by construction — the
 *  draft loop produces a review artifact per attempt, the render QA
 *  surface produces one warning type — so the per-surface numbers are
 *  the ones that compare like with like. */
export interface SurfaceReport {
  surface: string;
  total: number;
  correct: number;
  accuracy: number;
  brier: number | null;
  disputed: number;
  /** True when the surface was measured and retired — reported, but it
   *  does not gate the provider choice. */
  retired: boolean;
  /** The deterministic path's accuracy ON THIS SURFACE — over the cases
   *  that record a baseline. Null when the surface has no deterministic
   *  path (the draft-bar surface's baseline IS its label). */
  baselineAccuracy: number | null;
}

export interface ProviderReport {
  provider: string;
  model: string;
  label: string;
  total: number;
  /** How many calls produced a usable answer. */
  answered: number;
  correct: number;
  /** correct / total — an unanswered case counts as wrong. */
  accuracy: number;
  /** Brier score over the answered `noul` cases. null when there are
   *  none. */
  brier: number | null;
  /** How many `noul` answers fell inside their expected band. */
  bandHits: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  tokensIn: number;
  tokensOut: number;
  /** null when the price table has no price for this provider+model. */
  costPerDecision: number | null;
  /** The deterministic path's accuracy on the same cases. null when no
   *  case in the corpus has a baseline. */
  baselineAccuracy: number | null;
  /** How many of the cases carry a disputed label. */
  disputed: number;
  /** Accuracy over the cases whose label is not disputed. */
  accuracyStrict: number | null;
  eligible: boolean;
  /** Why the provider is not eligible (empty when it is). */
  reasons: string[];
  /** Per-surface numbers. */
  surfaces: SurfaceReport[];
  /** The cases in the run. */
  cases: CaseResult[];
  /** How many of the cases belong to an ACTIVE surface — the ones the
   *  gate is computed over. */
  activeCases: number;
  /** How many of the ACTIVE cases were answered correctly. */
  activeCorrect: number;
  /** How many belong to a retired surface (measured, kept, not wired). */
  retiredCases: number;
}

export interface BenchReport {
  generatedAt: string;
  cases: number;
  minAccuracy: number;
  maxBrier: number;
  providers: ProviderReport[];
  /** The eligible provider with the lowest cost, then the lowest p95.
   *  null when no provider is eligible. */
  winner: string | null;
}

export interface BenchOptions {
  provider?: string | undefined;
  /** Inject providers instead of building the known ones — the seam the
   *  tests use. A provider given here replaces the whole list. */
  providers?: BenchProviderSpec[] | undefined;
  surface?: DecisionSurface | undefined;
  caseId?: string | undefined;
  repeat?: number | undefined;
  samples?: number | undefined;
  model?: string | undefined;
  minAccuracy?: number | undefined;
  maxBrier?: number | undefined;
}

/** The providers the bench knows how to run. */
export function benchProviderSpecs(opts: {
  provider?: string | undefined;
  model?: string | undefined;
  samples?: number | undefined;
}): BenchProviderSpec[] {
  const samples = Math.max(1, opts.samples ?? 1);
  const all: BenchProviderSpec[] = [
    {
      id: "openai",
      label: "OpenAI Decisions API",
      model: opts.model ?? "gpt-6-luna",
      make: () =>
        new OpenAIDecisionProvider({ model: opts.model ?? "gpt-6-luna" }),
    },
    {
      id: "minimax",
      label: "MiniMax function calling",
      model: opts.model ?? "MiniMax-M3.1-Flash",
      make: () =>
        new MiniMaxDecisionProvider({
          model: opts.model ?? "MiniMax-M3.1-Flash",
          samples,
        }),
    },
  ];
  if (!opts.provider || opts.provider === "all") return all;
  const picked = all.filter((p) => p.id === opts.provider);
  if (picked.length === 0) {
    throw new Error(
      `unknown provider "${opts.provider}" — known: ${all.map((p) => p.id).join(", ")}`,
    );
  }
  return picked;
}

/** The decision request for one corpus case. */
export function requestForCase(ref: DecisionCaseRef): DecisionRequest {
  const spec = DECISION_QUESTIONS[ref.fixture.surface];
  const question: DecisionQuestion = {
    id: ref.fixture.id,
    kind: spec.kind,
    instructions: loadDecisionQuestion(ref.fixture.surface),
    ...(spec.options ? { options: spec.options } : {}),
    ...(spec.optionHints ? { optionHints: spec.optionHints } : {}),
    ...(spec.levels ? { levels: spec.levels } : {}),
    ...(spec.trueMeaning ? { trueMeaning: spec.trueMeaning } : {}),
    ...(spec.falseMeaning ? { falseMeaning: spec.falseMeaning } : {}),
    ...(spec.resultProperty ? { resultProperty: spec.resultProperty } : {}),
  };
  return { state: ref.fixture.state, question };
}

/** The comparable value of an answer, per question kind. */
function scalarOf(value: DecisionValue): string | number | boolean {
  if (value.kind === "choice") return value.option;
  if (value.kind === "score") return value.score;
  return value.probability;
}

/** Is the answer right for this case? */
export function isCorrect(
  expects: {
    kind: string;
    value: string | number | boolean;
    tolerance?: number | undefined;
  },
  got: string | number | boolean,
): boolean {
  if (expects.kind === "choice") return got === expects.value;
  if (expects.kind === "score") {
    if (typeof got !== "number" || typeof expects.value !== "number") {
      return false;
    }
    return Math.abs(got - expects.value) <= (expects.tolerance ?? 0.5);
  }
  // noul — the side the probability landed on.
  const saysTrue = typeof got === "number" ? got >= 0.5 : got === true;
  return saysTrue === (expects.value === true || expects.value === "true");
}

/** Does the probability fall inside the case's expected band? */
function inBand(
  expects: { probability?: [number, number] | undefined },
  got: string | number | boolean,
): boolean | null {
  if (!expects.probability) return null;
  if (typeof got !== "number") return false;
  const [min, max] = expects.probability;
  return got >= min && got <= max;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

/** The cost of one call, from the price table. null when the price is
 *  unknown — never 0. */
export function costOf(
  usage: { input: number; output: number },
  price:
    { input_per_1k: number | null; output_per_1k: number | null } | undefined,
): number | null {
  if (!price) return null;
  if (price.input_per_1k === null || price.output_per_1k === null) {
    return null;
  }
  return (
    (usage.input / 1000) * price.input_per_1k +
    (usage.output / 1000) * price.output_per_1k
  );
}

/**
 * The deterministic path's accuracy on ONE surface — over the cases of
 * that surface that record a baseline.
 *
 * The comparison is per surface on purpose: the corpus mixes surfaces
 * with very different deterministic paths, and a corpus-wide baseline
 * number is not a thing any provider can beat. The gate asks the
 * question that matters — "is this provider worse than doing nothing
 * on this surface?" — surface by surface.
 */
function surfaceBaselineAccuracy(
  surface: string,
  cases: DecisionCaseRef[],
  rows: CaseResult[],
): number | null {
  const ids = new Set(rows.map((r) => r.case));
  const withBaseline = cases.filter(
    (ref) => ids.has(ref.fixture.id) && ref.fixture.baseline !== undefined,
  );
  if (withBaseline.length === 0) return null;
  const correct = withBaseline.filter((ref) =>
    isCorrect(
      ref.fixture.expects,
      ref.fixture.baseline as string | number | boolean,
    ),
  ).length;
  return correct / withBaseline.length;
}

/** Run the bench. */
export async function runDecisionBench(
  opts: BenchOptions = {},
): Promise<BenchReport> {
  const repeat = Math.max(1, opts.repeat ?? 1);
  const minAccuracy = opts.minAccuracy ?? 0.9;
  const maxBrier = opts.maxBrier ?? 0.25;
  const cases = listDecisionCases({
    ...(opts.surface ? { surface: opts.surface } : {}),
    ...(opts.caseId ? { caseId: opts.caseId } : {}),
  });
  if (cases.length === 0) throw new Error("the decision corpus is empty");
  const prices = loadDecisionPrices();
  const specs =
    opts.providers ??
    benchProviderSpecs({
      ...(opts.provider ? { provider: opts.provider } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.samples ? { samples: opts.samples } : {}),
    });

  const providers: ProviderReport[] = [];
  for (const spec of specs) {
    const provider = spec.make();
    const results: CaseResult[] = [];
    const latencies: number[] = [];
    let tokensIn = 0;
    let tokensOut = 0;
    let cost = 0;
    let costKnown = true;

    for (const ref of cases) {
      const request = requestForCase(ref);
      const answers: DecisionAnswer[] = [];
      const errors: string[] = [];
      let usage = { input: 0, output: 0 };
      for (let i = 0; i < repeat; i += 1) {
        const answer = await provider.decide(request);
        if (!answer) {
          errors.push(provider.lastError?.message ?? "no answer");
          continue;
        }
        answers.push(answer);
        usage = {
          input: usage.input + answer.usage.input,
          output: usage.output + answer.usage.output,
        };
        latencies.push(answer.latencyMs);
        const call = costOf(answer.usage, prices.prices[spec.id]?.[spec.model]);
        if (call === null) costKnown = false;
        else cost += call;
      }
      tokensIn += usage.input;
      tokensOut += usage.output;

      // Aggregate the repeats: the majority answer wins, and the
      // probability is the mean over the answers that carried one.
      const scalars = answers.map((a) => scalarOf(a.value));
      const counts = new Map<string, number>();
      for (const scalar of scalars) {
        const key = String(scalar);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let majority: string | number | boolean | null = null;
      let best = 0;
      for (const [key, count] of counts) {
        if (count > best) {
          best = count;
          majority = scalars.find((s) => String(s) === key) ?? null;
        }
      }
      const confidence =
        answers.length === 0
          ? null
          : answers.reduce((sum, a) => sum + a.confidence, 0) / answers.length;
      const correct =
        majority === null ? null : isCorrect(ref.fixture.expects, majority);
      results.push({
        case: ref.fixture.id,
        surface: ref.fixture.surface,
        disputed: ref.fixture.disputed === true,
        got: majority,
        expected: ref.fixture.expects.value,
        correct,
        confidence,
        confidenceSource: answers[0]?.confidenceSource ?? null,
        inBand:
          majority === null ? null : inBand(ref.fixture.expects, majority),
        calls: repeat,
        latencyMs:
          answers.length === 0
            ? 0
            : answers.reduce((s, a) => s + a.latencyMs, 0) / answers.length,
        usage,
        error: errors.length > 0 ? (errors[0] ?? null) : null,
      });
    }

    const answered = results.filter((r) => r.got !== null).length;
    const correctCount = results.filter((r) => r.correct === true).length;
    // The gate is computed over the ACTIVE surfaces only. A surface
    // that was measured and retired keeps its cases (the measurement is
    // the deliverable) but must not drag the corpus-wide gate down: the
    // gate answers "can this provider carry the surfaces the pipeline
    // actually consults?", and a retired surface is not one of them.
    const activeResults = results.filter((r) => !isRetiredSurface(r.surface));
    const retiredCases = results.length - activeResults.length;
    const activeCorrect = activeResults.filter(
      (r) => r.correct === true,
    ).length;
    const accuracy =
      activeResults.length === 0 ? 0 : activeCorrect / activeResults.length;

    // Brier over the answered noul cases: (p − y)², averaged.
    const noulCases = results.filter(
      (r) => typeof r.got === "number" && r.expected !== undefined,
    );
    const noulAnswers = cases.filter(
      (ref) =>
        ref.fixture.expects.kind === "noul" &&
        !isRetiredSurface(ref.fixture.surface),
    );
    const brierValues: number[] = [];
    for (const ref of noulAnswers) {
      const result = results.find((r) => r.case === ref.fixture.id);
      if (!result || typeof result.got !== "number") continue;
      const truth =
        ref.fixture.expects.value === true ||
        ref.fixture.expects.value === "true"
          ? 1
          : 0;
      brierValues.push((result.got - truth) ** 2);
    }
    const brier =
      brierValues.length === 0
        ? null
        : brierValues.reduce((a, b) => a + b, 0) / brierValues.length;

    const bandHits =
      noulCases.length === 0
        ? null
        : noulCases.filter((r) => r.inBand === true).length;

    // The deterministic path's accuracy over the cases that record one.
    const withBaseline = cases.filter(
      (ref) =>
        ref.fixture.baseline !== undefined &&
        !isRetiredSurface(ref.fixture.surface),
    );
    const baselineAccuracy =
      withBaseline.length === 0
        ? null
        : withBaseline.filter((ref) =>
            isCorrect(
              ref.fixture.expects,
              ref.fixture.baseline as string | number | boolean,
            ),
          ).length / withBaseline.length;

    // Disputed labels: counted in the accuracy (hiding them would
    // flatter the providers), reported separately, and scored again
    // without them so a reader can see both numbers.
    const disputedRefs = cases.filter(
      (ref) =>
        ref.fixture.disputed === true && !isRetiredSurface(ref.fixture.surface),
    );
    const disputedCount = disputedRefs.length;
    const strictResults = activeResults.filter(
      (r) => !disputedRefs.some((ref) => ref.fixture.id === r.case),
    );
    const strictAccuracy =
      strictResults.length === 0
        ? null
        : strictResults.filter((r) => r.correct === true).length /
          strictResults.length;

    const reasons: string[] = [];
    if (accuracy < minAccuracy) {
      reasons.push(`accuracy ${accuracy.toFixed(3)} < ${minAccuracy}`);
    }
    if (brier !== null && brier > maxBrier) {
      reasons.push(`brier ${brier.toFixed(3)} > ${maxBrier}`);
    }
    // Per-surface numbers: the corpus is lopsided, so the surface a
    // case belongs to is the unit that compares like with like.
    const surfaceNames = [...new Set(results.map((r) => r.surface))].sort();
    const surfaces: SurfaceReport[] = surfaceNames.map((surface) => {
      const rows = results.filter((r) => r.surface === surface);
      const noulRows = rows.filter(
        (r): r is CaseResult & { got: number } => typeof r.got === "number",
      );
      const noulBrier: number[] = [];
      for (const row of noulRows) {
        const ref = cases.find((c) => c.fixture.id === row.case);
        if (!ref) continue;
        const truth =
          ref.fixture.expects.value === true ||
          ref.fixture.expects.value === "true"
            ? 1
            : 0;
        noulBrier.push((row.got - truth) ** 2);
      }
      return {
        surface,
        total: rows.length,
        correct: rows.filter((r) => r.correct === true).length,
        accuracy:
          rows.length === 0
            ? 0
            : rows.filter((r) => r.correct === true).length / rows.length,
        brier:
          noulBrier.length === 0
            ? null
            : noulBrier.reduce((a, b) => a + b, 0) / noulBrier.length,
        disputed: rows.filter((r) => r.disputed === true).length,
        retired: isRetiredSurface(surface as DecisionSurface),
        baselineAccuracy: surfaceBaselineAccuracy(surface, cases, rows),
      };
    });

    // The baseline comparison is PER SURFACE: the corpus mixes surfaces
    // with very different deterministic paths, and a corpus-wide
    // baseline number is not a thing any provider can beat. The gate
    // asks the question that matters — "is this provider worse than
    // doing nothing on THIS surface?" — surface by surface.
    for (const surface of surfaces) {
      if (surface.retired) continue;
      if (surface.baselineAccuracy === null) continue;
      if (surface.accuracy < surface.baselineAccuracy) {
        reasons.push(
          `${surface.surface}: accuracy ${surface.accuracy.toFixed(3)} < baseline ${surface.baselineAccuracy.toFixed(3)}`,
        );
      }
    }

    providers.push({
      provider: spec.id,
      model: spec.model,
      label: spec.label,
      total: results.length,
      answered,
      correct: correctCount,
      accuracy,
      brier,
      bandHits,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      tokensIn,
      tokensOut,
      costPerDecision:
        costKnown && latencies.length > 0 ? cost / latencies.length : null,
      baselineAccuracy,
      disputed: disputedCount,
      accuracyStrict: strictAccuracy,
      eligible: reasons.length === 0,
      reasons,
      surfaces,
      cases: results,
      activeCases: activeResults.length,
      activeCorrect,
      retiredCases,
    });
  }

  // The ranking: eligible providers only, cheapest first, then fastest.
  const eligible = providers
    .filter((p) => p.eligible)
    .sort((a, b) => {
      const ac = a.costPerDecision ?? Number.POSITIVE_INFINITY;
      const bc = b.costPerDecision ?? Number.POSITIVE_INFINITY;
      if (ac !== bc) return ac - bc;
      return (
        (a.p95Ms ?? Number.POSITIVE_INFINITY) -
        (b.p95Ms ?? Number.POSITIVE_INFINITY)
      );
    });

  return {
    generatedAt: new Date().toISOString(),
    cases: cases.length,
    minAccuracy,
    maxBrier,
    providers,
    winner: eligible[0]?.label ?? null,
  };
}

/** The report as a markdown table. */
export function renderBenchReport(report: BenchReport): string {
  const rows = report.providers.map((p) => {
    const cost =
      p.costPerDecision === null ? "n/a" : `$${p.costPerDecision.toFixed(6)}`;
    return `| ${p.label} | ${p.model} | ${p.activeCorrect}/${p.activeCases} | ${
      p.brier === null ? "n/a" : p.brier.toFixed(3)
    } | ${p.p50Ms === null ? "n/a" : `${p.p50Ms} ms`} | ${
      p.p95Ms === null ? "n/a" : `${p.p95Ms} ms`
    } | ${cost} | ${p.eligible ? "✅" : `❌ ${p.reasons.join("; ")}`} |`;
  });
  const baseline = report.providers[0]?.baselineAccuracy;
  return [
    `| provider | model | accuracy | brier | p50 | p95 | cost/decision | eligible |`,
    `|---|---|---|---|---|---|---|---|`,
    ...rows,
    "",
    `cases: ${report.cases} · deterministic baseline accuracy: ${
      baseline === null || baseline === undefined ? "n/a" : baseline.toFixed(3)
    } · gates: accuracy ≥ ${report.minAccuracy}, brier ≤ ${report.maxBrier}`,
    ...(report.providers[0]?.retiredCases
      ? [
          `· ${report.providers[0].retiredCases} case(s) belong to a RETIRED surface — reported below, not gated`,
        ]
      : []),
    ...report.providers.map(
      (p) =>
        `· ${p.label}: ${p.disputed} disputed label(s), accuracy over the undisputed cases ${
          p.accuracyStrict === null ? "n/a" : p.accuracyStrict.toFixed(3)
        }`,
    ),
    "",
    ...report.providers.flatMap((p) => [
      `per surface — ${p.label}:`,
      `| surface | cases | accuracy | brier | disputed | baseline |`,
      `|---|---|---|---|---|---|`,
      ...p.surfaces.map(
        (s) =>
          `| ${s.surface}${s.retired ? " (retired)" : ""} | ${s.correct}/${s.total} | ${s.accuracy.toFixed(3)} | ${
            s.brier === null ? "n/a" : s.brier.toFixed(3)
          } | ${s.disputed} | ${
            s.baselineAccuracy === null ? "n/a" : s.baselineAccuracy.toFixed(3)
          } |`,
      ),
      "",
    ]),
    report.winner === null
      ? "winner: none — no provider cleared the gates"
      : `winner: ${report.winner}`,
  ].join("\n");
}

/** `video decision bench` — the verb. */
export function registerDecision(program: Command): void {
  const decision = program
    .command("decision")
    .description(
      "Decision layer tools: `video decision bench` measures the decision providers against the corpus; `video decision harvest` turns a project's shadow log into corpus candidates; `video decision backfill` consults the model about a project's existing review attempts.",
    );

  decision
    .command("bench")
    .description(
      "Measure the decision providers (accuracy, calibration, latency, cost) against the corpus.",
    )
    .option("--provider <id>", "openai | minimax | all", "all")
    .option(
      "--surface <surface>",
      "one surface (qa-triage, draft-bar, visual-class, …)",
    )
    .option("--case <id>", "one case id")
    .option("--repeat <n>", "calls per case", "1")
    .option("--samples <n>", "MiniMax samples per call (vote mode)", "1")
    .option("--model <id>", "override the model id")
    .option("--min-accuracy <n>", "accuracy gate", "0.9")
    .option(
      "--max-brier <n>",
      "Brier gate (0.25 = always answering 0.5)",
      "0.25",
    )
    .option("--out <path>", "write the JSON report here")
    .option("--json", "print the JSON report instead of the table")
    .action(async (options: Record<string, string | boolean>) => {
      const report = await runDecisionBench({
        provider:
          typeof options["provider"] === "string"
            ? options["provider"]
            : undefined,
        surface:
          typeof options["surface"] === "string"
            ? (options["surface"] as DecisionSurface)
            : undefined,
        caseId:
          typeof options["case"] === "string" ? options["case"] : undefined,
        repeat: Number(options["repeat"] ?? 1),
        samples: Number(options["samples"] ?? 1),
        model:
          typeof options["model"] === "string" ? options["model"] : undefined,
        minAccuracy: Number(options["minAccuracy"] ?? 0.9),
        maxBrier: Number(options["maxBrier"] ?? 0.25),
      });
      if (options["json"]) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(renderBenchReport(report));
      }
      const out = typeof options["out"] === "string" ? options["out"] : null;
      if (out) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(out, JSON.stringify(report, null, 2));
        console.log(`\nreport written: ${out}`);
      }
    });

  registerDecisionHarvest(decision);
  registerDecisionBackfill(decision);
}
